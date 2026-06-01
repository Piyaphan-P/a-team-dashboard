'use strict';

/**
 * Activity log module — F1.a
 *
 * Owns all activity logging concerns for the agent-team dashboard.
 * Exposes:
 *   logEvent({ eventType, teamName, agentName, taskId, summary, payload, timestamp }) -> void
 *   readEvents({ date, eventType, limit }) -> Promise<ActivityLogEvent[]>
 *
 * Storage: ~/.claude/activity-logs/YYYY-MM-DD.jsonl (one JSON object per line, UTF-8).
 * Writes are serialized through a module-scoped Promise chain so concurrent callers
 * never interleave bytes within a line.  logEvent is fire-and-forget — it returns
 * undefined synchronously and the actual I/O completes asynchronously.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/** Recognised event type strings. */
const VALID_EVENT_TYPES = ['spawn', 'message', 'completion', 'error'];

/** Matches a YYYY-MM-DD date string (minimal validation — not a full calendar check). */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Maximum serialized line size in bytes before the payload is truncated. */
const MAX_LINE_BYTES = 4096;

/** Default number of events returned by readEvents when limit is not specified. */
const DEFAULT_LIMIT = 200;

/** Hard upper bound on the limit parameter for readEvents. */
const MAX_LIMIT = 1000;

// ---------------------------------------------------------------------------
// DUPLICATED FROM server.js — keep in sync with the originals
// ---------------------------------------------------------------------------

const IS_WINDOWS = process.platform === 'win32';
const { exec } = require('child_process');

/**
 * Restricts file permissions to the current user only (cross-platform).
 * On Windows uses icacls; on Unix uses chmod 600.
 * @param {string} filePath - Absolute path to the file to lock down
 * @returns {Promise<void>}
 */
// DUPLICATED FROM server.js
async function lockFilePermissions(filePath) {
  if (IS_WINDOWS) {
    const escaped = filePath.replace(/\//g, '\\');
    await new Promise((resolve) => {
      exec(`icacls "${escaped}" /inheritance:r /grant:r "%USERNAME%":F`, resolve);
    });
  } else {
    await fs.chmod(filePath, 0o600);
  }
}

/**
 * Sanitizes a string for safe logging by stripping control characters (CR, LF, tab, etc.)
 * and truncating to 200 characters to prevent log injection attacks.
 * @param {*} input - The value to sanitize (coerced to string)
 * @returns {string} A safe-to-log string with no control characters, max 200 chars
 */
// DUPLICATED FROM server.js
function sanitizeForLog(input) {
  return String(input ?? '').replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').slice(0, 200);
}

/**
 * Validates that a file path resolves within an allowed directory to prevent path traversal.
 * @param {string} filePath - The file path to validate
 * @param {string} allowedDir - The directory the path must reside within
 * @returns {string} The normalized absolute path
 * @throws {Error} If the path escapes the allowed directory
 */
// DUPLICATED FROM server.js
function validatePath(filePath, allowedDir) {
  const normalizedPath = path.resolve(filePath);
  const normalizedDir = path.resolve(allowedDir);
  const relativePath = path.relative(normalizedDir, normalizedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Path traversal attempt detected');
  }
  return normalizedPath;
}

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

/** Absolute path to the activity-log directory. */
const LOG_DIR = path.join(os.homedir(), '.claude', 'activity-logs');

/**
 * Serialized write queue — each write appends to the previous Promise so that
 * concurrent logEvent calls never overlap bytes in the output file.
 * @type {Promise<void>}
 */
let writeQueue = Promise.resolve();

/**
 * Tracks which UTC date strings (YYYY-MM-DD) have already had their log file
 * created and chmod'd this process lifetime, so we only call lockFilePermissions
 * once per day per process.
 * @type {Set<string>}
 */
const lockedDates = new Set();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Performs the actual disk I/O for a single log entry.
 * Idempotently creates LOG_DIR, creates the daily file if absent,
 * applies 0600 permissions on first creation for the day, then appends the line.
 *
 * @param {string} line  - Serialized JSON line (already includes trailing '\n')
 * @param {string} dateStr - UTC date string YYYY-MM-DD derived from the event timestamp
 * @returns {Promise<void>}
 */
async function doWrite(line, dateStr) {
  // Ensure log directory exists (idempotent)
  await fs.mkdir(LOG_DIR, { recursive: true });

  // Build and validate the file path
  const filePath = validatePath(path.join(LOG_DIR, `${dateStr}.jsonl`), LOG_DIR);

  // On first write for this UTC day: create the file if absent and lock perms
  if (!lockedDates.has(dateStr)) {
    // fs.open with 'a' creates the file if it does not exist, no-ops if it does
    const fh = await fs.open(filePath, 'a');
    await fh.close();
    await lockFilePermissions(filePath);
    lockedDates.add(dateStr);
  }

  await fs.appendFile(filePath, line, 'utf8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Logs an activity event asynchronously.
 *
 * Fire-and-forget: always returns undefined synchronously.  I/O errors are
 * reported to console.error but never propagated to the caller.
 *
 * Throws synchronously only for programmer errors (invalid eventType), so
 * mis-wired call sites surface failures at dev time.
 *
 * @param {object} params
 * @param {string}      params.eventType  - Required. One of VALID_EVENT_TYPES.
 * @param {string}      [params.teamName]  - Team name; sanitized via sanitizeForLog.
 * @param {string|null} [params.agentName] - Agent name or null.
 * @param {string|null} [params.taskId]    - Task identifier or null.
 * @param {string}      [params.summary]   - Short human-readable description.
 * @param {object}      [params.payload]   - Small JSON payload; truncated if line > 4096 bytes.
 * @param {string}      [params.timestamp] - ISO8601 UTC; defaults to Date.now().
 * @returns {void}
 */
function logEvent({ eventType, teamName, agentName, taskId, summary, payload, timestamp } = {}) {
  // Synchronous validation — programmer error guard
  if (!VALID_EVENT_TYPES.includes(eventType)) {
    throw new Error(
      `[ACTIVITY-LOG] Invalid eventType "${eventType}". Must be one of: ${VALID_EVENT_TYPES.join(', ')}`
    );
  }

  // Build the event object with sanitized fields
  const event = {
    timestamp: (typeof timestamp === 'string' && timestamp) ? timestamp : new Date().toISOString(),
    eventType,
    teamName: sanitizeForLog(teamName ?? ''),
    agentName: agentName != null ? sanitizeForLog(agentName) : null,
    taskId: taskId != null ? sanitizeForLog(taskId) : null,
    summary: sanitizeForLog(summary ?? ''),
    payload: (payload !== null && typeof payload === 'object') ? payload : {}
  };

  // Derive the UTC date string for the daily file name
  const dateStr = event.timestamp.slice(0, 10); // YYYY-MM-DD

  // Serialize and optionally truncate the payload
  let line = JSON.stringify(event);
  const byteLen = Buffer.byteLength(line, 'utf8');
  if (byteLen > MAX_LINE_BYTES) {
    const truncatedEvent = {
      ...event,
      payload: { truncated: true, originalBytes: byteLen }
    };
    line = JSON.stringify(truncatedEvent);
  }
  line += '\n';

  // Enqueue write — fire-and-forget; errors are logged but not re-thrown
  writeQueue = writeQueue
    .then(() => doWrite(line, dateStr))
    .catch((err) => {
      console.error('[ACTIVITY-LOG] write error:', err.message);
    });
  // Return undefined immediately — caller must not await this
}

/**
 * Reads activity log events for a given UTC date, optionally filtered by event type.
 *
 * Returns an empty array when no log file exists for the requested date (ENOENT).
 * Rejects with a descriptive Error for invalid inputs.
 *
 * @param {object} params
 * @param {string} [params.date]       - UTC date YYYY-MM-DD; defaults to today.
 * @param {string} [params.eventType]  - Optional filter; must be in VALID_EVENT_TYPES.
 * @param {number} [params.limit]      - Maximum events to return; clamped to [1, 1000]; default 200.
 * @returns {Promise<Array<object>>}   - Events sorted newest-first (timestamp DESC).
 */
async function readEvents({ date, eventType, limit } = {}) {
  // --- Input validation ---

  // Date: default to today UTC; validate format when provided
  let resolvedDate;
  if (date === undefined || date === null) {
    resolvedDate = new Date().toISOString().slice(0, 10);
  } else {
    if (typeof date !== 'string' || !DATE_REGEX.test(date)) {
      throw new Error('Invalid date: expected YYYY-MM-DD format');
    }
    resolvedDate = date;
  }

  // eventType: validate against whitelist when provided
  if (eventType !== undefined && eventType !== null) {
    if (!VALID_EVENT_TYPES.includes(eventType)) {
      throw new Error(`Invalid eventType "${eventType}". Must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
    }
  }

  // limit: parse, default, clamp
  let resolvedLimit;
  if (limit === undefined || limit === null) {
    resolvedLimit = DEFAULT_LIMIT;
  } else {
    const parsed = parseInt(limit, 10);
    if (isNaN(parsed) || parsed < 1) {
      throw new Error('Invalid limit: must be an integer >= 1');
    }
    resolvedLimit = Math.min(parsed, MAX_LIMIT);
  }

  // Build and validate the file path
  const filePath = validatePath(path.join(LOG_DIR, `${resolvedDate}.jsonl`), LOG_DIR);

  // Read and parse lines via readline (streaming — avoids loading multi-MB files into memory)
  const events = [];
  try {
    const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const rawLine of rl) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue; // skip blank lines
      try {
        const parsed = JSON.parse(trimmed);
        events.push(parsed);
      } catch (parseErr) {
        console.error('[ACTIVITY-LOG] Skipping unparseable line:', parseErr.message);
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return []; // No log file for this date — normal, not an error
    }
    throw err;
  }

  // Filter by eventType if requested
  const filtered = eventType
    ? events.filter((e) => e.eventType === eventType)
    : events;

  // Sort newest-first, slice to limit
  filtered.sort((a, b) => {
    if (a.timestamp > b.timestamp) return -1;
    if (a.timestamp < b.timestamp) return 1;
    return 0;
  });

  return filtered.slice(0, resolvedLimit);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  logEvent,
  readEvents,
  // Constants (consumed by chunk B wiring and the REST route handler)
  VALID_EVENT_TYPES,
  DATE_REGEX,
  MAX_LINE_BYTES,
  DEFAULT_LIMIT,
  MAX_LIMIT
};

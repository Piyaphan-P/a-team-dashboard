/**
 * Token usage aggregator for Claude Code sessions.
 *
 * Scans ~/.claude/projects/{project-slug}/{session-id}.jsonl files,
 * parses `message.usage` from assistant turns, and produces aggregates
 * per session / project / model.
 *
 * Files are line-delimited JSON. We stream-read so very large logs do
 * not blow up memory. Results are cached by file mtime+size so repeat
 * requests are O(changed files), not O(total bytes).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const readline = require('readline');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// session-id => { mtime, size, summary }
const fileCache = new Map();

const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // session considered "active" if mtime within 5 min

function emptyTotals() {
  return {
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
    total: 0,
    messages: 0,
  };
}

function addTotals(a, b) {
  a.input += b.input;
  a.output += b.output;
  a.cacheCreation += b.cacheCreation;
  a.cacheRead += b.cacheRead;
  a.total += b.total;
  a.messages += b.messages;
}

/**
 * Stream-parse one .jsonl file and return per-model token totals + meta.
 */
async function parseSessionFile(filePath, projectSlug, sessionId) {
  const stat = await fsp.stat(filePath);
  const cacheKey = filePath;
  const cached = fileCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.summary;
  }

  const byModel = new Map(); // model => totals
  const totals = emptyTotals();
  let firstTimestamp = null;
  let lastTimestamp = null;
  let cwd = null;

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // skip malformed line
    }

    if (entry.cwd && !cwd) cwd = entry.cwd;
    if (entry.timestamp) {
      if (!firstTimestamp) firstTimestamp = entry.timestamp;
      lastTimestamp = entry.timestamp;
    }

    const msg = entry.message;
    if (!msg || !msg.usage) continue;

    const u = msg.usage;
    const t = {
      input: Number(u.input_tokens || 0),
      output: Number(u.output_tokens || 0),
      cacheCreation: Number(u.cache_creation_input_tokens || 0),
      cacheRead: Number(u.cache_read_input_tokens || 0),
      messages: 1,
    };
    t.total = t.input + t.output + t.cacheCreation + t.cacheRead;

    const model = msg.model || 'unknown';
    if (!byModel.has(model)) byModel.set(model, emptyTotals());
    addTotals(byModel.get(model), t);
    addTotals(totals, t);
  }

  const summary = {
    sessionId,
    projectSlug,
    cwd,
    firstTimestamp,
    lastTimestamp,
    mtimeMs: stat.mtimeMs,
    sizeBytes: stat.size,
    totals,
    byModel: Object.fromEntries(byModel),
  };

  fileCache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size, summary });
  return summary;
}

/**
 * Walk PROJECTS_DIR and return every session summary.
 */
async function scanAllSessions() {
  let projectDirs;
  try {
    projectDirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const sessions = [];
  for (const ent of projectDirs) {
    if (!ent.isDirectory()) continue;
    const projectSlug = ent.name;
    const projectPath = path.join(PROJECTS_DIR, projectSlug);
    let files;
    try {
      files = await fsp.readdir(projectPath);
    } catch {
      continue;
    }
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
    const parsed = await Promise.all(
      jsonlFiles.map(async (file) => {
        const sessionId = path.basename(file, '.jsonl');
        const fullPath = path.join(projectPath, file);
        try {
          return await parseSessionFile(fullPath, projectSlug, sessionId);
        } catch (err) {
          console.error('usage: failed to parse', file, err.message);
          return null;
        }
      })
    );
    parsed.forEach((p) => p && sessions.push(p));
  }
  return sessions;
}

/**
 * Convert a project slug like "-Users-yourname-Projects-MyProject"
 * back into a readable name (just the last segment).
 */
function prettyProjectName(slug, cwd) {
  if (cwd) return path.basename(cwd);
  // slug uses '-' as separator instead of '/'. Last segment after final '-'.
  const parts = slug.split('-').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : slug;
}

/**
 * Build top-level summary used by /api/usage/summary.
 */
async function getSummary() {
  const sessions = await scanAllSessions();
  const totals = emptyTotals();
  const byModel = new Map();
  const byProject = new Map();
  const now = Date.now();
  let activeCount = 0;

  for (const s of sessions) {
    addTotals(totals, s.totals);
    for (const [model, t] of Object.entries(s.byModel)) {
      if (!byModel.has(model)) byModel.set(model, emptyTotals());
      addTotals(byModel.get(model), t);
    }
    const projKey = s.projectSlug;
    if (!byProject.has(projKey)) {
      byProject.set(projKey, {
        slug: projKey,
        name: prettyProjectName(projKey, s.cwd),
        cwd: s.cwd,
        sessions: 0,
        totals: emptyTotals(),
      });
    }
    const proj = byProject.get(projKey);
    proj.sessions += 1;
    addTotals(proj.totals, s.totals);
    if (s.cwd) proj.cwd = s.cwd;

    if (now - s.mtimeMs < ACTIVE_WINDOW_MS) activeCount += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    activeSessionCount: activeCount,
    totals,
    byModel: Object.fromEntries(byModel),
    byProject: Array.from(byProject.values()).sort(
      (a, b) => b.totals.total - a.totals.total
    ),
  };
}

/**
 * Per-session list sorted by recency (most recent activity first).
 * Each entry is lighter than the raw summary; full details available via /api/usage/sessions/:id.
 */
async function getSessions({ limit = 100, projectSlug = null } = {}) {
  const sessions = await scanAllSessions();
  const now = Date.now();
  const filtered = projectSlug
    ? sessions.filter((s) => s.projectSlug === projectSlug)
    : sessions;
  filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return filtered.slice(0, limit).map((s) => ({
    sessionId: s.sessionId,
    projectSlug: s.projectSlug,
    projectName: prettyProjectName(s.projectSlug, s.cwd),
    cwd: s.cwd,
    firstTimestamp: s.firstTimestamp,
    lastTimestamp: s.lastTimestamp,
    isActive: now - s.mtimeMs < ACTIVE_WINDOW_MS,
    totals: s.totals,
    byModel: s.byModel,
  }));
}

/**
 * Look up a single session by id (searches across all projects).
 */
async function getSession(sessionId) {
  const sessions = await scanAllSessions();
  const found = sessions.find((s) => s.sessionId === sessionId);
  if (!found) return null;
  return {
    ...found,
    projectName: prettyProjectName(found.projectSlug, found.cwd),
    isActive: Date.now() - found.mtimeMs < ACTIVE_WINDOW_MS,
  };
}

function invalidateCache(filePath) {
  if (filePath) fileCache.delete(filePath);
  else fileCache.clear();
}

module.exports = {
  PROJECTS_DIR,
  ACTIVE_WINDOW_MS,
  getSummary,
  getSessions,
  getSession,
  scanAllSessions,
  parseSessionFile,
  invalidateCache,
};

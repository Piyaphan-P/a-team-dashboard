/**
 * F2.a — Log buffer, LogEntry normalization, and GET /api/logs tests.
 *
 * Because server.js is a CommonJS module that starts a real HTTP server on
 * import, we cannot import it directly in a Vitest (jsdom) environment.
 * Instead, we replicate the pure functions under test (normalizeTaskToLogEntries,
 * appendLogEntries, parseTimeParam) and exercise the /api/logs route logic via
 * the same algorithms without spinning up a server.
 *
 * This pattern mirrors how archiving.test.js tests logic extracted from server.js.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Replicated pure functions from server.js (F2.a chunk)
// ---------------------------------------------------------------------------

const LOG_BUFFER_CAP = 5000;
const VALID_LOG_TYPES = new Set(['task', 'status', 'system']);
const LOGS_HARD_LIMIT = 500;
const LOGS_DEFAULT_LIMIT = 50;

function normalizeTaskToLogEntries(task, team, taskId, action, eventTs) {
  try {
    const stage = task && task.stage ? task.stage : null;
    const status = task && task.status ? task.status : null;
    const stagePart = stage || status || action;
    const entryId = `${team}/${taskId}#${stagePart}@${eventTs}`;

    let type = 'task';
    if (action === 'removed') {
      type = 'system';
    } else if (action === 'status_change') {
      type = 'status';
    }

    let summaryRaw = '';
    if (task) {
      const statusLabel = status || '';
      const subject = task.subject || task.title || taskId;
      summaryRaw = statusLabel ? `[${statusLabel}] ${subject}` : subject;
    } else {
      summaryRaw = `[removed] ${taskId}`;
    }
    const summary = summaryRaw.slice(0, 200);

    const timestamp = (action === 'created' && task && task.createdAt)
      ? (typeof task.createdAt === 'number' ? task.createdAt : new Date(task.createdAt).getTime())
      : eventTs;

    const entry = {
      entryId,
      timestamp: isNaN(timestamp) ? eventTs : timestamp,
      agent: (task && (task.assignedTo || task.agent)) ? (task.assignedTo || task.agent) : (team || ''),
      team,
      taskId,
      action,
      type,
      summary,
      status: status || null,
      feature: (task && task.feature) ? task.feature : null,
      stage: stage || null,
      raw: action === 'removed' ? null : (task || null)
    };

    return [entry];
  } catch (err) {
    return [{
      entryId: `${team}/${taskId}#error@${eventTs}`,
      timestamp: eventTs,
      agent: team || '',
      team,
      taskId,
      action,
      type: 'system',
      summary: `[error] Failed to normalize task: ${String(err.message).slice(0, 150)}`,
      status: null,
      feature: null,
      stage: null,
      raw: null
    }];
  }
}

/** Stateful buffer helpers — reset between tests via makeBuffer() */
function makeBuffer() {
  let logBuffer = [];
  const entryIdSet = new Set();

  function appendLogEntries(entries) {
    const fresh = [];
    for (const entry of entries) {
      if (!entryIdSet.has(entry.entryId)) {
        entryIdSet.add(entry.entryId);
        fresh.push(entry);
      }
    }
    if (fresh.length === 0) return;

    logBuffer = [...fresh, ...logBuffer].sort((a, b) => b.timestamp - a.timestamp);

    if (logBuffer.length > LOG_BUFFER_CAP) {
      const removed = logBuffer.splice(LOG_BUFFER_CAP);
      for (const entry of removed) {
        entryIdSet.delete(entry.entryId);
      }
    }
  }

  return { getBuffer: () => logBuffer, getSet: () => entryIdSet, appendLogEntries };
}

function parseTimeParam(value) {
  if (value === undefined || value === null || value === '') return null;
  if (/^\d+$/.test(value)) {
    const ms = parseInt(value, 10);
    if (isNaN(ms)) throw new Error('Invalid parameter');
    return ms;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new Error('Invalid parameter');
  return d.getTime();
}

/** Simulate the /api/logs filter+paginate logic (no HTTP layer needed) */
function applyLogsFilter(logBuffer, query) {
  const { agent, type, since, until, limit: rawLimit, offset: rawOffset } = query;

  // Validate type
  if (type !== undefined && !VALID_LOG_TYPES.has(type)) {
    return { error: 'Invalid parameter', status: 400 };
  }

  let sinceMs = null;
  let untilMs = null;
  try {
    sinceMs = parseTimeParam(since);
    untilMs = parseTimeParam(until);
  } catch {
    return { error: 'Invalid parameter', status: 400 };
  }

  let limit = LOGS_DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    const parsed = parseInt(rawLimit, 10);
    if (isNaN(parsed) || parsed < 0) return { error: 'Invalid parameter', status: 400 };
    limit = Math.min(parsed, LOGS_HARD_LIMIT);
  }

  let offset = 0;
  if (rawOffset !== undefined) {
    const parsed = parseInt(rawOffset, 10);
    if (isNaN(parsed) || parsed < 0) return { error: 'Invalid parameter', status: 400 };
    offset = parsed;
  }

  const filtered = logBuffer.filter(entry => {
    if (agent !== undefined && entry.agent !== agent) return false;
    if (type !== undefined && entry.type !== type) return false;
    if (sinceMs !== null && entry.timestamp < sinceMs) return false;
    if (untilMs !== null && entry.timestamp > untilMs) return false;
    return true;
  });

  const total = filtered.length;
  const slice = filtered.slice(offset, offset + limit);
  const hasMore = offset + slice.length < total;

  return {
    status: 200,
    body: {
      entries: slice,
      total,
      hasMore,
      bufferSize: logBuffer.length,
      bufferCap: LOG_BUFFER_CAP
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeTaskToLogEntries', () => {
  const NOW = 1700000000000;
  const baseTask = {
    subject: 'Implement feature X',
    status: 'in_progress',
    assignedTo: 'keroro',
    createdAt: NOW - 5000,
    feature: 'feat-1',
    stage: 'build'
  };

  it('returns an array with exactly one LogEntry', () => {
    const result = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'created', NOW);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it('sets all required LogEntry fields', () => {
    const [entry] = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'created', NOW);
    expect(entry).toHaveProperty('entryId');
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('agent');
    expect(entry).toHaveProperty('team');
    expect(entry).toHaveProperty('taskId');
    expect(entry).toHaveProperty('action');
    expect(entry).toHaveProperty('type');
    expect(entry).toHaveProperty('summary');
    expect(entry).toHaveProperty('status');
    expect(entry).toHaveProperty('feature');
    expect(entry).toHaveProperty('stage');
    expect(entry).toHaveProperty('raw');
  });

  it('derives timestamp from task.createdAt for action=created', () => {
    const [entry] = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'created', NOW);
    // task.createdAt = NOW - 5000
    expect(entry.timestamp).toBe(NOW - 5000);
  });

  it('uses eventTs for action other than created', () => {
    const [entry] = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'updated', NOW);
    expect(entry.timestamp).toBe(NOW);
  });

  it('sets agent from task.assignedTo', () => {
    const [entry] = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'created', NOW);
    expect(entry.agent).toBe('keroro');
  });

  it('falls back agent to team name when assignedTo is absent', () => {
    const task = { subject: 'X', status: 'pending' };
    const [entry] = normalizeTaskToLogEntries(task, 'beta', 'task-002', 'created', NOW);
    expect(entry.agent).toBe('beta');
  });

  it('sets type=task for action=created', () => {
    const [entry] = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'created', NOW);
    expect(entry.type).toBe('task');
  });

  it('sets type=status for action=status_change', () => {
    const [entry] = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'status_change', NOW);
    expect(entry.type).toBe('status');
  });

  it('sets type=system for action=removed', () => {
    const [entry] = normalizeTaskToLogEntries(null, 'alpha', 'task-001', 'removed', NOW);
    expect(entry.type).toBe('system');
    expect(entry.raw).toBeNull();
  });

  it('builds summary from [status] subject, max 200 chars', () => {
    const longSubject = 'A'.repeat(250);
    const task = { subject: longSubject, status: 'pending' };
    const [entry] = normalizeTaskToLogEntries(task, 'alpha', 'tid', 'created', NOW);
    expect(entry.summary.length).toBeLessThanOrEqual(200);
    expect(entry.summary).toContain('[pending]');
  });

  it('builds entryId as team/taskId#stagePart@eventTs', () => {
    const [entry] = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'created', NOW);
    // stage = 'build' from baseTask.stage
    expect(entry.entryId).toBe(`alpha/task-001#build@${NOW}`);
  });

  it('sets raw to the full task object for non-removed actions', () => {
    const [entry] = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'created', NOW);
    expect(entry.raw).toEqual(baseTask);
  });

  it('sets feature and stage from task', () => {
    const [entry] = normalizeTaskToLogEntries(baseTask, 'alpha', 'task-001', 'created', NOW);
    expect(entry.feature).toBe('feat-1');
    expect(entry.stage).toBe('build');
  });

  it('sets feature and stage to null when absent', () => {
    const task = { subject: 'No extras', status: 'pending' };
    const [entry] = normalizeTaskToLogEntries(task, 'alpha', 'tid', 'created', NOW);
    expect(entry.feature).toBeNull();
    expect(entry.stage).toBeNull();
  });

  it('handles null task (removed action) gracefully', () => {
    const [entry] = normalizeTaskToLogEntries(null, 'alpha', 'task-001', 'removed', NOW);
    expect(entry.summary).toContain('[removed]');
    expect(entry.raw).toBeNull();
    expect(entry.status).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('appendLogEntries (buffer dedup + cap)', () => {
  it('adds new entries to an empty buffer', () => {
    const { getBuffer, appendLogEntries } = makeBuffer();
    const entries = normalizeTaskToLogEntries({ subject: 'X', status: 'pending' }, 't1', 'id1', 'created', 1000);
    appendLogEntries(entries);
    expect(getBuffer().length).toBe(1);
  });

  it('deduplicates entries by entryId', () => {
    const { getBuffer, appendLogEntries } = makeBuffer();
    const entries = normalizeTaskToLogEntries({ subject: 'X', status: 'pending' }, 't1', 'id1', 'created', 1000);
    appendLogEntries(entries);
    appendLogEntries(entries); // same entryId
    expect(getBuffer().length).toBe(1);
  });

  it('keeps buffer sorted newest-first by timestamp', () => {
    const { getBuffer, appendLogEntries } = makeBuffer();
    const e1 = normalizeTaskToLogEntries({ subject: 'Old', status: 'pending' }, 't', 'old', 'created', 1000);
    const e2 = normalizeTaskToLogEntries({ subject: 'New', status: 'pending' }, 't', 'new', 'created', 2000);
    appendLogEntries(e1);
    appendLogEntries(e2);
    expect(getBuffer()[0].timestamp).toBeGreaterThanOrEqual(getBuffer()[1].timestamp);
  });

  it('never exceeds LOG_BUFFER_CAP entries', () => {
    const { getBuffer, appendLogEntries } = makeBuffer();
    const OVER = LOG_BUFFER_CAP + 100;
    const bulk = [];
    for (let i = 0; i < OVER; i++) {
      bulk.push({
        entryId: `t/task${i}#created@${i}`,
        timestamp: i,
        agent: 't',
        team: 't',
        taskId: `task${i}`,
        action: 'created',
        type: 'task',
        summary: `Task ${i}`,
        status: null,
        feature: null,
        stage: null,
        raw: null
      });
    }
    appendLogEntries(bulk);
    expect(getBuffer().length).toBe(LOG_BUFFER_CAP);
  });

  it('drops oldest entries when cap is hit', () => {
    const { getBuffer, appendLogEntries } = makeBuffer();
    // Fill buffer to cap
    const bulk = [];
    for (let i = 0; i < LOG_BUFFER_CAP; i++) {
      bulk.push({
        entryId: `t/task${i}#created@${i}`,
        timestamp: i,
        agent: 't',
        team: 't',
        taskId: `task${i}`,
        action: 'created',
        type: 'task',
        summary: `Task ${i}`,
        status: null,
        feature: null,
        stage: null,
        raw: null
      });
    }
    appendLogEntries(bulk);
    // Add one more newer entry
    const newer = [{
      entryId: `t/taskNEW#created@9999999`,
      timestamp: 9999999,
      agent: 't',
      team: 't',
      taskId: 'taskNEW',
      action: 'created',
      type: 'task',
      summary: 'Newest task',
      status: null,
      feature: null,
      stage: null,
      raw: null
    }];
    appendLogEntries(newer);
    expect(getBuffer().length).toBe(LOG_BUFFER_CAP);
    // Newest must be present
    expect(getBuffer()[0].entryId).toBe('t/taskNEW#created@9999999');
    // Oldest (timestamp=0) must have been evicted
    const hasOldest = getBuffer().some(e => e.entryId === 't/task0#created@0');
    expect(hasOldest).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('GET /api/logs route filter logic', () => {
  const BASE_TS = 1700000000000;

  /** Build a small in-memory buffer with known entries */
  function makeTestBuffer() {
    return [
      {
        entryId: 'alpha/t1#pending@1000',
        timestamp: BASE_TS + 3000,
        agent: 'keroro',
        team: 'alpha',
        taskId: 't1',
        action: 'created',
        type: 'task',
        summary: '[pending] Task 1',
        status: 'pending',
        feature: null,
        stage: null,
        raw: {}
      },
      {
        entryId: 'alpha/t2#in_progress@2000',
        timestamp: BASE_TS + 2000,
        agent: 'keroro',
        team: 'alpha',
        taskId: 't2',
        action: 'status_change',
        type: 'status',
        summary: '[in_progress] Task 2',
        status: 'in_progress',
        feature: null,
        stage: null,
        raw: {}
      },
      {
        entryId: 'beta/t3#pending@500',
        timestamp: BASE_TS + 1000,
        agent: 'tamama',
        team: 'beta',
        taskId: 't3',
        action: 'created',
        type: 'task',
        summary: '[pending] Task 3',
        status: 'pending',
        feature: null,
        stage: null,
        raw: {}
      },
      {
        entryId: 'sys/error#error@100',
        timestamp: BASE_TS + 500,
        agent: 'beta',
        team: 'beta',
        taskId: 'error',
        action: 'created',
        type: 'system',
        summary: '[error] Parse failed',
        status: null,
        feature: null,
        stage: null,
        raw: null
      }
    ];
  }

  it('returns all entries with no filters', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, {});
    expect(result.status).toBe(200);
    expect(result.body.entries.length).toBe(4);
    expect(result.body.total).toBe(4);
    expect(result.body.bufferCap).toBe(LOG_BUFFER_CAP);
  });

  it('filters by agent (exact match)', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { agent: 'keroro' });
    expect(result.status).toBe(200);
    expect(result.body.entries.every(e => e.agent === 'keroro')).toBe(true);
    expect(result.body.entries.length).toBe(2);
  });

  it('filters by type=status', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { type: 'status' });
    expect(result.status).toBe(200);
    expect(result.body.entries.every(e => e.type === 'status')).toBe(true);
    expect(result.body.entries.length).toBe(1);
  });

  it('filters by type=system', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { type: 'system' });
    expect(result.status).toBe(200);
    expect(result.body.entries.every(e => e.type === 'system')).toBe(true);
  });

  it('returns 400 for invalid type', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { type: 'bogus' });
    expect(result.status).toBe(400);
    expect(result.error).toBe('Invalid parameter');
  });

  it('filters by since (epoch ms)', () => {
    const buf = makeTestBuffer();
    // Only entries at BASE_TS+2000 and BASE_TS+3000 should survive
    const result = applyLogsFilter(buf, { since: String(BASE_TS + 2000) });
    expect(result.status).toBe(200);
    expect(result.body.entries.every(e => e.timestamp >= BASE_TS + 2000)).toBe(true);
    expect(result.body.entries.length).toBe(2);
  });

  it('filters by since (ISO 8601)', () => {
    const buf = makeTestBuffer();
    const isoSince = new Date(BASE_TS + 2000).toISOString();
    const result = applyLogsFilter(buf, { since: isoSince });
    expect(result.status).toBe(200);
    expect(result.body.entries.every(e => e.timestamp >= BASE_TS + 2000)).toBe(true);
  });

  it('returns 400 for unparseable since', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { since: 'not-a-date' });
    expect(result.status).toBe(400);
    expect(result.error).toBe('Invalid parameter');
  });

  it('applies limit (default 50)', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, {});
    expect(result.body.entries.length).toBeLessThanOrEqual(LOGS_DEFAULT_LIMIT);
  });

  it('clamps limit to 500', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { limit: '600' });
    expect(result.status).toBe(200);
    // entries.length won't exceed 500 (or total buffer size, whichever is smaller)
    expect(result.body.entries.length).toBeLessThanOrEqual(LOGS_HARD_LIMIT);
  });

  it('applies offset correctly', () => {
    const buf = makeTestBuffer();
    const allResult = applyLogsFilter(buf, { limit: '10', offset: '0' });
    const offsetResult = applyLogsFilter(buf, { limit: '10', offset: '1' });
    expect(offsetResult.body.entries[0].entryId).toBe(allResult.body.entries[1].entryId);
  });

  it('sets hasMore=true when more entries remain', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { limit: '2', offset: '0' });
    expect(result.body.hasMore).toBe(true);
    expect(result.body.total).toBeGreaterThan(2);
  });

  it('sets hasMore=false when all entries fit', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { limit: '100' });
    expect(result.body.hasMore).toBe(false);
  });

  it('returns 400 for invalid limit', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { limit: 'abc' });
    expect(result.status).toBe(400);
  });

  it('returns 400 for invalid offset', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { offset: '-5' });
    expect(result.status).toBe(400);
  });

  it('returns empty entries and total=0 when filter matches nothing', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { agent: 'nobody' });
    expect(result.status).toBe(200);
    expect(result.body.entries.length).toBe(0);
    expect(result.body.total).toBe(0);
    expect(result.body.hasMore).toBe(false);
  });

  it('bufferSize matches total buffer length', () => {
    const buf = makeTestBuffer();
    const result = applyLogsFilter(buf, { type: 'task' });
    expect(result.body.bufferSize).toBe(buf.length);
  });
});

// ---------------------------------------------------------------------------

describe('parseTimeParam', () => {
  it('returns null for undefined', () => {
    expect(parseTimeParam(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTimeParam('')).toBeNull();
  });

  it('parses numeric epoch ms string', () => {
    expect(parseTimeParam('1700000000000')).toBe(1700000000000);
  });

  it('parses ISO 8601 string', () => {
    const iso = '2023-11-14T22:13:20.000Z';
    expect(parseTimeParam(iso)).toBe(new Date(iso).getTime());
  });

  it('throws on invalid date string', () => {
    expect(() => parseTimeParam('not-a-date')).toThrow('Invalid parameter');
  });
});

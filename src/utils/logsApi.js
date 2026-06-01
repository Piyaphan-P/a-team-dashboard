import { apiFetch } from './api.js';
import dayjs from 'dayjs';

/**
 * Convert a human-readable time range string into an epoch-ms cutoff timestamp.
 *
 * @param {'all'|'today'|'7d'|'30d'} range
 * @returns {number|undefined} Epoch ms cutoff, or undefined when range is 'all'.
 */
export function rangeToSince(range) {
  if (!range || range === 'all') return undefined;

  const now = dayjs();

  if (range === 'today') {
    return now.startOf('day').valueOf();
  }
  if (range === '7d') {
    return now.subtract(7, 'day').valueOf();
  }
  if (range === '30d') {
    return now.subtract(30, 'day').valueOf();
  }

  return undefined;
}

/**
 * Fetch a page of log entries from GET /api/logs.
 *
 * @param {Object} params
 * @param {string}  [params.agent]   - Exact agent name filter
 * @param {string}  [params.type]    - 'task' | 'status' | 'system'
 * @param {number}  [params.since]   - Epoch ms lower bound (inclusive)
 * @param {number}  [params.until]   - Epoch ms upper bound (inclusive)
 * @param {number}  [params.limit]   - Number of entries to return (default 50, max 500)
 * @param {number}  [params.offset]  - Pagination offset (default 0)
 * @returns {Promise<{entries: Array, total: number, hasMore: boolean, bufferSize: number, bufferCap: number}>}
 */
export async function fetchLogs({ agent, type, since, until, limit, offset } = {}) {
  const params = new URLSearchParams();

  if (agent !== undefined && agent !== null && agent !== '') {
    params.set('agent', String(agent));
  }
  if (type !== undefined && type !== null && type !== '') {
    params.set('type', String(type));
  }
  if (since !== undefined && since !== null) {
    params.set('since', String(since));
  }
  if (until !== undefined && until !== null) {
    params.set('until', String(until));
  }
  if (limit !== undefined && limit !== null) {
    params.set('limit', String(limit));
  }
  if (offset !== undefined && offset !== null) {
    params.set('offset', String(offset));
  }

  const qs = params.toString();
  const url = qs ? `/api/logs?${qs}` : '/api/logs';

  const res = await apiFetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

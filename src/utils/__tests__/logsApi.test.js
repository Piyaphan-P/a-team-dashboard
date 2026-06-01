import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import dayjs from 'dayjs';

// ---------------------------------------------------------------------------
// logsApi is an ESM module that imports apiFetch (which accesses sessionStorage /
// fetch). We mock the entire api.js module before importing logsApi so no real
// network calls or DOM access happen in tests.
// ---------------------------------------------------------------------------
vi.mock('../api.js', () => ({
  apiFetch: vi.fn(),
}));

import { fetchLogs, rangeToSince } from '../logsApi.js';
import { apiFetch } from '../api.js';

// ---------------------------------------------------------------------------
// rangeToSince
// ---------------------------------------------------------------------------
describe('rangeToSince', () => {
  it("returns undefined for 'all'", () => {
    expect(rangeToSince('all')).toBeUndefined();
  });

  it("returns undefined when called with no argument", () => {
    expect(rangeToSince()).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(rangeToSince('')).toBeUndefined();
  });

  it("returns start-of-today epoch ms for 'today'", () => {
    const result = rangeToSince('today');
    const expected = dayjs().startOf('day').valueOf();
    // Allow 1 second of skew between invocations
    expect(result).toBeGreaterThanOrEqual(expected - 1000);
    expect(result).toBeLessThanOrEqual(expected + 1000);
  });

  it("'today' result is less than current time", () => {
    expect(rangeToSince('today')).toBeLessThanOrEqual(Date.now());
  });

  it("returns now-7d epoch ms for '7d'", () => {
    const before = dayjs().subtract(7, 'day').valueOf();
    const result = rangeToSince('7d');
    const after = dayjs().subtract(7, 'day').valueOf();
    expect(result).toBeGreaterThanOrEqual(before - 1000);
    expect(result).toBeLessThanOrEqual(after + 1000);
  });

  it("returns now-30d epoch ms for '30d'", () => {
    const before = dayjs().subtract(30, 'day').valueOf();
    const result = rangeToSince('30d');
    const after = dayjs().subtract(30, 'day').valueOf();
    expect(result).toBeGreaterThanOrEqual(before - 1000);
    expect(result).toBeLessThanOrEqual(after + 1000);
  });

  it("'7d' result is less than '30d' result", () => {
    // 7 days ago is MORE RECENT (larger number) than 30 days ago
    expect(rangeToSince('7d')).toBeGreaterThan(rangeToSince('30d'));
  });

  it("returns undefined for unknown range", () => {
    expect(rangeToSince('1y')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchLogs — query string construction
// ---------------------------------------------------------------------------
describe('fetchLogs', () => {
  const mockJson = vi.fn();

  beforeEach(() => {
    mockJson.mockResolvedValue({
      entries: [],
      total: 0,
      hasMore: false,
      bufferSize: 0,
      bufferCap: 5000,
    });
    apiFetch.mockResolvedValue({ ok: true, json: mockJson });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/logs with no query string when no params provided', async () => {
    await fetchLogs();
    expect(apiFetch).toHaveBeenCalledWith('/api/logs');
  });

  it('includes agent, type, since, limit, offset in query string', async () => {
    await fetchLogs({ agent: 'a', type: 'task', since: 1700000000000, limit: 50, offset: 0 });
    const url = apiFetch.mock.calls[0][0];
    expect(url).toBe('/api/logs?agent=a&type=task&since=1700000000000&limit=50&offset=0');
  });

  it('omits undefined params', async () => {
    await fetchLogs({ agent: 'bob' });
    const url = apiFetch.mock.calls[0][0];
    expect(url).toContain('agent=bob');
    expect(url).not.toContain('type=');
    expect(url).not.toContain('since=');
    expect(url).not.toContain('limit=');
    expect(url).not.toContain('offset=');
  });

  it('omits null params', async () => {
    await fetchLogs({ agent: null, type: null, limit: 25 });
    const url = apiFetch.mock.calls[0][0];
    expect(url).not.toContain('agent=');
    expect(url).not.toContain('type=');
    expect(url).toContain('limit=25');
  });

  it('omits empty-string params', async () => {
    await fetchLogs({ agent: '', type: 'system' });
    const url = apiFetch.mock.calls[0][0];
    expect(url).not.toContain('agent=');
    expect(url).toContain('type=system');
  });

  it('includes until param when provided', async () => {
    await fetchLogs({ until: 1700999999999 });
    const url = apiFetch.mock.calls[0][0];
    expect(url).toContain('until=1700999999999');
  });

  it('returns parsed JSON from the response', async () => {
    const expected = {
      entries: [{ entryId: 'x' }],
      total: 1,
      hasMore: false,
      bufferSize: 1,
      bufferCap: 5000,
    };
    mockJson.mockResolvedValueOnce(expected);
    const result = await fetchLogs({ limit: 10 });
    expect(result).toEqual(expected);
  });

  it('throws an error when response is not ok', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: 'Invalid parameter' }),
    });
    await expect(fetchLogs({ type: 'bad' })).rejects.toThrow('Invalid parameter');
  });

  it('throws HTTP status error when json parse fails on error response', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new SyntaxError('bad json')),
    });
    await expect(fetchLogs()).rejects.toThrow('HTTP 500');
  });

  it('builds correct URL with all parameters including since and offset=0', async () => {
    await fetchLogs({ agent: 'a', type: 'task', since: 1700000000000, limit: 50, offset: 0 });
    const [calledUrl] = apiFetch.mock.calls[0];
    const parsed = new URL(calledUrl, 'http://localhost');
    expect(parsed.searchParams.get('agent')).toBe('a');
    expect(parsed.searchParams.get('type')).toBe('task');
    expect(parsed.searchParams.get('since')).toBe('1700000000000');
    expect(parsed.searchParams.get('limit')).toBe('50');
    expect(parsed.searchParams.get('offset')).toBe('0');
  });
});

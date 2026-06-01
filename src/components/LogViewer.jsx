import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { FileText, ArrowUp, Download, X, ChevronDown, ChevronRight } from 'lucide-react';
import { SkeletonInboxViewer } from './SkeletonLoader';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { fetchLogs, rangeToSince } from '../utils/logsApi.js';
import { exportToCSV, exportToJSON } from '../utils/exportUtils.js';
import { getAgentColor, getAgentInitials } from '../utils/formatting.js';
import toast from 'react-hot-toast';
import { List, useDynamicRowHeight } from 'react-window';

const VIRTUALIZE_THRESHOLD = 200;

function VirtualRow({ index, style, ariaAttributes, entries, rowHeight }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !rowHeight?.observeRowElements) return undefined;
    return rowHeight.observeRowElements([ref.current]);
  }, [rowHeight]);

  const entry = entries[index];
  if (!entry) return null;

  return (
    <div style={style} {...ariaAttributes}>
      <div ref={ref} style={{ paddingBottom: '0.375rem' }}>
        <LogRow entry={entry} />
      </div>
    </div>
  );
}

VirtualRow.propTypes = {
  index: PropTypes.number.isRequired,
  style: PropTypes.object,
  ariaAttributes: PropTypes.object,
  entries: PropTypes.array.isRequired,
  rowHeight: PropTypes.object,
};

dayjs.extend(relativeTime);

// ---- file-local avatar helpers (copied from InboxViewer — NOT extracted) ----
const TAILWIND_TO_HEX = {
  'bg-blue-600': '#3b82f6',
  'bg-purple-600': '#a855f7',
  'bg-green-600': '#22c55e',
  'bg-red-600': '#ef4444',
  'bg-yellow-600': '#eab308',
  'bg-pink-600': '#ec4899',
  'bg-indigo-600': '#6366f1',
  'bg-orange-500': '#f97316',
};

function getAvatarColor(name) {
  return TAILWIND_TO_HEX[getAgentColor(name)] || '#3b82f6';
}

function getInitials(name) {
  if (!name) return '??';
  const result = getAgentInitials(name);
  return result || name.substring(0, 2).toUpperCase();
}

// ---- status badge colours ----
const STATUS_COLORS = {
  pending: { bg: 'rgba(107, 114, 128, 0.2)', color: '#9ca3af', border: 'rgba(107, 114, 128, 0.4)' },
  in_progress: { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: 'rgba(59, 130, 246, 0.4)' },
  completed: { bg: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', border: 'rgba(34, 197, 94, 0.4)' },
  removed: { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: 'rgba(239, 68, 68, 0.4)' },
};

function StatusBadge({ status }) {
  if (!status) return null;
  const s = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <span style={{
      fontSize: '0.6875rem',
      fontWeight: 600,
      padding: '0.125rem 0.5rem',
      borderRadius: '9999px',
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.border}`,
      flexShrink: 0,
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

StatusBadge.propTypes = { status: PropTypes.string };

// ---- action badge ----
const ACTION_COLORS = {
  created: { bg: 'rgba(34, 197, 94, 0.15)', color: '#4ade80' },
  updated: { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' },
  status_change: { bg: 'rgba(249, 115, 22, 0.15)', color: '#fb923c' },
  completed: { bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' },
  removed: { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171' },
};

function ActionBadge({ action }) {
  if (!action) return null;
  const c = ACTION_COLORS[action] || { bg: 'rgba(107,114,128,0.2)', color: '#9ca3af' };
  return (
    <span style={{
      fontSize: '0.625rem',
      fontWeight: 700,
      padding: '0.1rem 0.4rem',
      borderRadius: '4px',
      background: c.bg,
      color: c.color,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      flexShrink: 0,
    }}>
      {action.replace(/_/g, ' ')}
    </span>
  );
}

ActionBadge.propTypes = { action: PropTypes.string };

// ---- single log row ----
function LogRow({ entry }) {
  const [expanded, setExpanded] = useState(false);

  const ts = entry.timestamp ? dayjs(entry.timestamp) : null;
  const relTime = ts ? ts.fromNow() : '';
  const fullTime = ts ? ts.format('YYYY-MM-DD HH:mm:ss') : '';

  return (
    <div
      style={{
        padding: '0.5rem 0.75rem',
        borderRadius: '0 8px 8px 0',
        borderLeft: `4px solid ${getAvatarColor(entry.agent || '')}`,
        background: 'var(--bg-card)',
        transition: 'background 0.15s ease',
        cursor: 'pointer',
      }}
      onClick={() => setExpanded(prev => !prev)}
      role="button"
      aria-expanded={expanded}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(prev => !prev); } }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        {/* avatar */}
        <div style={{
          width: '26px',
          height: '26px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.5625rem',
          fontWeight: 700,
          color: 'white',
          flexShrink: 0,
          background: getAvatarColor(entry.agent || ''),
        }}>
          {getInitials(entry.agent || '??')}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* top row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-heading)', flexShrink: 0 }}>
              {entry.agent || '(unknown)'}
            </span>
            {entry.team && (
              <span className="text-xs" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                @{entry.team}
              </span>
            )}
            <ActionBadge action={entry.action} />
            <StatusBadge status={entry.status} />
            <span style={{ flex: 1 }} />
            {ts && (
              <span
                className="text-xs"
                title={fullTime}
                style={{ color: 'var(--text-muted)', flexShrink: 0 }}
              >
                {relTime}
              </span>
            )}
            {expanded
              ? <ChevronDown style={{ height: '12px', width: '12px', color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
              : <ChevronRight style={{ height: '12px', width: '12px', color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
            }
          </div>

          {/* summary */}
          <p className="text-xs" style={{
            color: 'var(--text-secondary)',
            marginBottom: expanded ? '0.5rem' : 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: expanded ? 'normal' : 'nowrap',
            maxWidth: '100%',
          }}>
            {entry.summary || '(no summary)'}
          </p>

          {/* expanded raw JSON */}
          {expanded && (
            <pre
              className="text-xs"
              style={{
                color: 'var(--text-muted)',
                background: 'var(--code-bg)',
                border: '1px solid var(--code-border)',
                maxHeight: '200px',
                overflowY: 'auto',
                overflowX: 'auto',
                padding: '0.5rem',
                borderRadius: '4px',
                marginTop: '0.25rem',
                marginBottom: 0,
              }}
            >
              <code>{entry.raw ? JSON.stringify(entry.raw, null, 2) : '(no raw data — entry was removed)'}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

LogRow.propTypes = {
  entry: PropTypes.shape({
    entryId: PropTypes.string,
    timestamp: PropTypes.number,
    agent: PropTypes.string,
    team: PropTypes.string,
    action: PropTypes.string,
    type: PropTypes.string,
    summary: PropTypes.string,
    status: PropTypes.string,
    raw: PropTypes.object,
  }).isRequired,
};

// ---- deduplicate entries by entryId ----
function dedup(entries) {
  const seen = new Set();
  return entries.filter(e => {
    if (seen.has(e.entryId)) return false;
    seen.add(e.entryId);
    return true;
  });
}

const EXPORT_CAP = 10_000;
const PAGE_SIZE = 50;

// ---- main component ----
export function LogViewer({ logs: wsLogs = [], loading: initialLoading = false }) {
  // filter state
  const [agentFilter, setAgentFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [timeRange, setTimeRange] = useState('all'); // all | today | 7d | 30d

  // REST pagination state
  const [pageEntries, setPageEntries] = useState([]);
  const [pageOffset, setPageOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [restTotal, setRestTotal] = useState(0);
  const [restLoading, setRestLoading] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // live entry pill
  const [newLiveCount, setNewLiveCount] = useState(0);
  const [isAtTop, setIsAtTop] = useState(true);

  const feedRef = useRef(null);
  const prevWsLogCountRef = useRef(0);

  // react-window dynamic-height cache for virtualized large lists (>200 entries)
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 72 });

  // --- fetchLogs wrapper ---
  const doFetch = useCallback(async ({ offset = 0, reset = false } = {}) => {
    if (reset) setLoadingInitial(true);
    setRestLoading(true);
    try {
      const since = rangeToSince(timeRange);
      const params = { limit: PAGE_SIZE, offset };
      if (agentFilter !== 'all') params.agent = agentFilter;
      if (typeFilter !== 'all') params.type = typeFilter;
      if (since !== undefined) params.since = since;

      const res = await fetchLogs(params);
      const entries = Array.isArray(res.entries) ? res.entries : [];
      setHasMore(!!res.hasMore);
      setRestTotal(typeof res.total === 'number' ? res.total : entries.length);

      if (reset || offset === 0) {
        setPageEntries(entries);
        setPageOffset(entries.length);
      } else {
        setPageEntries(prev => dedup([...prev, ...entries]));
        setPageOffset(prev => prev + entries.length);
      }
    } catch (err) {
      console.error('[LogViewer] fetchLogs error:', err);
    } finally {
      setRestLoading(false);
      if (reset) setLoadingInitial(false);
    }
  }, [agentFilter, typeFilter, timeRange]);

  // on mount and filter change — reset offset and re-fetch
  useEffect(() => {
    setPageOffset(0);
    setPageEntries([]);
    doFetch({ offset: 0, reset: true });
    // reset live pill on filter change
    setNewLiveCount(0);
  }, [agentFilter, typeFilter, timeRange]); // intentionally not including doFetch in deps to avoid double-fetch

  // load more
  const handleLoadMore = useCallback(() => {
    doFetch({ offset: pageOffset, reset: false });
  }, [doFetch, pageOffset]);

  // merge WS live entries with REST entries; track new live arrivals
  useEffect(() => {
    const prev = prevWsLogCountRef.current;
    const cur = wsLogs.length;
    if (cur > prev) {
      const delta = cur - prev;
      if (!isAtTop) {
        setNewLiveCount(n => n + delta);
      }
    }
    prevWsLogCountRef.current = cur;
  }, [wsLogs.length, isAtTop]);

  // scroll handler — detect if at top of feed
  const handleScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    const atTop = el.scrollTop < 60;
    setIsAtTop(atTop);
    if (atTop) setNewLiveCount(0);
  }, []);

  const scrollToTop = () => {
    const el = feedRef.current;
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
    setNewLiveCount(0);
  };

  // apply client-side filters to WS live entries
  const filteredWsLogs = useMemo(() => {
    let entries = wsLogs;
    if (agentFilter !== 'all') entries = entries.filter(e => e.agent === agentFilter);
    if (typeFilter !== 'all') entries = entries.filter(e => e.type === typeFilter);
    const since = rangeToSince(timeRange);
    if (since !== undefined) entries = entries.filter(e => e.timestamp >= since);
    return entries;
  }, [wsLogs, agentFilter, typeFilter, timeRange]);

  // merged deduplicated list: WS live entries prepended to REST entries
  const mergedEntries = useMemo(() => {
    return dedup([...filteredWsLogs, ...pageEntries]);
  }, [filteredWsLogs, pageEntries]);

  // unique agents from merged set for agent dropdown
  const uniqueAgents = useMemo(() => {
    const agents = new Set();
    mergedEntries.forEach(e => { if (e.agent) agents.add(e.agent); });
    // also include any from wsLogs so dropdown stays populated
    wsLogs.forEach(e => { if (e.agent) agents.add(e.agent); });
    return Array.from(agents).sort();
  }, [mergedEntries, wsLogs]);

  const anyFilterActive = agentFilter !== 'all' || typeFilter !== 'all' || timeRange !== 'all';

  // --- export helpers ---
  const handleExportJSON = useCallback(() => {
    let data = mergedEntries;
    let trimmed = false;
    if (data.length > EXPORT_CAP) {
      data = data.slice(0, EXPORT_CAP);
      trimmed = true;
    }
    if (trimmed) toast('Export trimmed to first 10,000 rows', { icon: 'i' });
    const filename = `logs-${dayjs().format('YYYYMMDD')}`;
    exportToJSON(data, filename);
  }, [mergedEntries]);

  const handleExportCSV = useCallback(() => {
    let data = mergedEntries.map(e => ({
      entryId: e.entryId || '',
      timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : '',
      agent: e.agent || '',
      team: e.team || '',
      taskId: e.taskId || '',
      action: e.action || '',
      type: e.type || '',
      status: e.status || '',
      summary: (e.summary || '').replace(/\n/g, ' '),
      feature: e.feature || '',
      stage: e.stage || '',
    }));
    let trimmed = false;
    if (data.length > EXPORT_CAP) {
      data = data.slice(0, EXPORT_CAP);
      trimmed = true;
    }
    if (trimmed) toast('Export trimmed to first 10,000 rows', { icon: 'i' });
    const filename = `logs-${dayjs().format('YYYYMMDD')}`;
    exportToCSV(data, filename);
  }, [mergedEntries]);

  // show skeleton on very first load
  if (loadingInitial && initialLoading) {
    return <SkeletonInboxViewer />;
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        className="log-viewer-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          height: '600px',
          minHeight: 0,
        }}
      >
        {/* ===== LEFT: filter rail ===== */}
        <div style={{
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-secondary)',
        }}>
          {/* header */}
          <div style={{
            padding: '1rem 1rem 0.75rem 1rem',
            borderBottom: '1px solid var(--border-color)',
            flexShrink: 0,
          }}>
            <div className="flex items-center gap-2" style={{ marginBottom: '0.25rem' }}>
              <FileText style={{ height: '18px', width: '18px', color: '#ff8a3d' }} aria-hidden="true" />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-heading)' }}>Filters</span>
            </div>
            <p className="text-xs" style={{ marginBottom: 0, color: 'var(--text-muted)' }}>
              {restTotal} entr{restTotal !== 1 ? 'ies' : 'y'} on server
            </p>
          </div>

          {/* filter controls */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
            {/* Agent */}
            <div style={{ marginBottom: '1rem' }}>
              <label
                htmlFor="log-agent-filter"
                className="text-xs"
                style={{ display: 'block', marginBottom: '0.3rem', color: 'var(--text-muted)' }}
              >
                Agent
              </label>
              <select
                id="log-agent-filter"
                value={agentFilter}
                onChange={e => setAgentFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.35rem 0.5rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.8125rem',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="all">All agents</option>
                {uniqueAgents.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>

            {/* Type */}
            <div style={{ marginBottom: '1rem' }}>
              <label
                htmlFor="log-type-filter"
                className="text-xs"
                style={{ display: 'block', marginBottom: '0.3rem', color: 'var(--text-muted)' }}
              >
                Type
              </label>
              <select
                id="log-type-filter"
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.35rem 0.5rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.8125rem',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="all">All</option>
                <option value="task">task</option>
                <option value="status">status</option>
                <option value="system">system</option>
              </select>
            </div>

            {/* Time range */}
            <div style={{ marginBottom: '1rem' }}>
              <p className="text-xs" style={{ marginBottom: '0.3rem', color: 'var(--text-muted)' }}>Time range</p>
              {[
                { value: 'all', label: 'All' },
                { value: 'today', label: 'Today' },
                { value: '7d', label: 'Last 7 days' },
                { value: '30d', label: 'Last 30 days' },
              ].map(opt => (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    marginBottom: '0.35rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="log-time-range"
                    value={opt.value}
                    checked={timeRange === opt.value}
                    onChange={() => setTimeRange(opt.value)}
                    style={{ accentColor: '#f97316', cursor: 'pointer' }}
                  />
                  <span className="text-xs" style={{ color: timeRange === opt.value ? 'var(--text-heading)' : 'var(--text-primary)' }}>
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>

            {/* Clear filters */}
            {anyFilterActive && (
              <button
                onClick={() => { setAgentFilter('all'); setTypeFilter('all'); setTimeRange('all'); }}
                aria-label="Clear all filters"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.3rem 0.625rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#f87171',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <X style={{ height: '11px', width: '11px' }} aria-hidden="true" /> Clear filters
              </button>
            )}
          </div>
        </div>

        {/* ===== RIGHT: log feed ===== */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
          position: 'relative',
        }}>
          {/* header row */}
          <div style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            gap: '0.5rem',
          }}>
            <div>
              <h4 className="text-sm font-semibold" style={{ marginBottom: 0, color: 'var(--text-heading)' }}>
                Logs
              </h4>
              <p className="text-xs" style={{ marginBottom: 0, color: 'var(--text-muted)' }}>
                {mergedEntries.length} entr{mergedEntries.length !== 1 ? 'ies' : 'y'} shown
                {anyFilterActive && ' (filtered)'}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <button
                onClick={handleExportJSON}
                aria-label="Export JSON"
                title="Export as JSON"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--tab-inactive-bg)',
                  color: 'var(--text-muted)',
                  fontSize: '0.6875rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249, 115, 22, 0.5)'; e.currentTarget.style.color = '#fb923c'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <Download style={{ height: '11px', width: '11px' }} aria-hidden="true" />
                Export JSON
              </button>
              <button
                onClick={handleExportCSV}
                aria-label="Export CSV"
                title="Export as CSV"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--tab-inactive-bg)',
                  color: 'var(--text-muted)',
                  fontSize: '0.6875rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249, 115, 22, 0.5)'; e.currentTarget.style.color = '#fb923c'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <Download style={{ height: '11px', width: '11px' }} aria-hidden="true" />
                Export CSV
              </button>
            </div>
          </div>

          {/* scrollable feed */}
          <div
            ref={feedRef}
            onScroll={handleScroll}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '0.75rem 1rem',
              minHeight: 0,
            }}
          >
            {loadingInitial || (restLoading && mergedEntries.length === 0) ? (
              <SkeletonInboxViewer />
            ) : mergedEntries.length === 0 ? (
              /* empty state */
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: '4rem',
              }}>
                <FileText style={{ height: '40px', width: '40px', color: '#4b5563', marginBottom: '0.75rem' }} aria-hidden="true" />
                <p className="text-sm" style={{ marginBottom: 0, color: 'var(--text-secondary)' }}>
                  {anyFilterActive ? 'No entries match your filters' : 'No log entries yet'}
                </p>
                {!anyFilterActive && (
                  <p className="text-xs" style={{ marginTop: '0.25rem', marginBottom: 0, color: 'var(--text-muted)' }}>
                    Log entries will appear here when tasks run
                  </p>
                )}
              </div>
            ) : mergedEntries.length > VIRTUALIZE_THRESHOLD ? (
              /* Virtualized — react-window for >200 entries */
              <div style={{ height: '100%', minHeight: '400px' }}>
                <List
                  rowComponent={VirtualRow}
                  rowCount={mergedEntries.length}
                  rowHeight={rowHeight}
                  rowProps={{ entries: mergedEntries, rowHeight }}
                  defaultHeight={500}
                  overscanCount={5}
                />
                {hasMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '0.75rem' }}>
                    <button
                      onClick={handleLoadMore}
                      disabled={restLoading}
                      aria-label="Load more log entries"
                      style={{
                        padding: '0.375rem 1.25rem',
                        borderRadius: '9999px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--tab-inactive-bg)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.75rem',
                        cursor: restLoading ? 'wait' : 'pointer',
                        opacity: restLoading ? 0.6 : 1,
                      }}
                    >
                      {restLoading ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {mergedEntries.map(entry => (
                  <LogRow key={entry.entryId || `${entry.timestamp}-${entry.agent}-${entry.action}`} entry={entry} />
                ))}

                {/* Load more */}
                {hasMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '0.75rem' }}>
                    <button
                      onClick={handleLoadMore}
                      disabled={restLoading}
                      aria-label="Load more log entries"
                      style={{
                        padding: '0.375rem 1.25rem',
                        borderRadius: '9999px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--tab-inactive-bg)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.75rem',
                        cursor: restLoading ? 'wait' : 'pointer',
                        transition: 'all 0.15s ease',
                        opacity: restLoading ? 0.6 : 1,
                      }}
                    >
                      {restLoading ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* "N new entries" pill — appears when live entries arrive while scrolled down */}
          {newLiveCount > 0 && (
            <div style={{
              position: 'absolute',
              top: '4rem',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10,
            }}>
              <button
                onClick={scrollToTop}
                aria-label={`Scroll to top to see ${newLiveCount} new entr${newLiveCount !== 1 ? 'ies' : 'y'}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.375rem 0.875rem',
                  borderRadius: '9999px',
                  border: '1px solid rgba(249, 115, 22, 0.4)',
                  background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.9), rgba(251, 146, 60, 0.9))',
                  color: 'white',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(249, 115, 22, 0.4)',
                }}
              >
                <ArrowUp style={{ height: '12px', width: '12px' }} aria-hidden="true" />
                {newLiveCount} new entr{newLiveCount !== 1 ? 'ies' : 'y'}
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .log-viewer-grid {
            grid-template-columns: 1fr !important;
            height: auto !important;
          }
          .log-viewer-grid > div:first-child {
            border-right: none !important;
            border-bottom: 1px solid var(--border-color);
            max-height: 200px;
          }
          .log-viewer-grid > div:last-child {
            min-height: 400px;
          }
        }
      `}</style>
    </div>
  );
}

LogViewer.propTypes = {
  logs: PropTypes.arrayOf(PropTypes.shape({
    entryId: PropTypes.string,
    timestamp: PropTypes.number,
    agent: PropTypes.string,
    team: PropTypes.string,
    taskId: PropTypes.string,
    action: PropTypes.string,
    type: PropTypes.string,
    summary: PropTypes.string,
    status: PropTypes.string,
    feature: PropTypes.string,
    stage: PropTypes.string,
    raw: PropTypes.object,
  })),
  loading: PropTypes.bool,
};

import React, { useEffect, useState, useMemo } from 'react';
import { Coins, Activity, Cpu, FolderGit2, Clock, Layers } from 'lucide-react';
import { apiFetch } from '../utils/api';

const POLL_INTERVAL_MS = 30000;

const MODEL_COLORS = {
  'claude-opus-4-7': '#f97316',
  'claude-opus-4-8': '#ea580c',
  'claude-sonnet-4-6': '#3b82f6',
  'claude-haiku-4-5': '#22c55e',
  'claude-haiku-4-5-20251001': '#22c55e',
  'gemini-3-flash': '#a855f7',
  'gemini-3-flash-preview': '#c084fc',
  'qwen3-coder-plus': '#ec4899',
  '<synthetic>': '#6b7280',
  unknown: '#6b7280',
};

function colorForModel(model) {
  if (MODEL_COLORS[model]) return MODEL_COLORS[model];
  if (model?.startsWith('claude-opus')) return '#f97316';
  if (model?.startsWith('claude-sonnet')) return '#3b82f6';
  if (model?.startsWith('claude-haiku')) return '#22c55e';
  if (model?.startsWith('gemini')) return '#a855f7';
  if (model?.startsWith('qwen')) return '#ec4899';
  return '#6b7280';
}

function formatTokens(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatFullNumber(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

function formatRelative(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

function StatCard({ icon: Icon, label, value, subLabel, tone = 'orange' }) {
  const toneColor = {
    orange: '#f97316',
    blue: '#3b82f6',
    green: '#22c55e',
    purple: '#a855f7',
  }[tone] || '#f97316';
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: 'var(--bg-card-gradient)',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--card-shadow)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} style={{ color: toneColor }} />
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-heading)' }}>
        {value}
      </div>
      {subLabel && (
        <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{subLabel}</div>
      )}
    </div>
  );
}

function Card({ title, icon: Icon, children, action }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'var(--bg-card-gradient)',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--card-shadow)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={16} style={{ color: '#f97316' }} />}
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-heading)' }}>{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function ModelBreakdown({ byModel, grandTotal }) {
  const entries = useMemo(() => {
    return Object.entries(byModel || {})
      .map(([model, t]) => ({ model, ...t }))
      .sort((a, b) => b.total - a.total);
  }, [byModel]);

  if (!entries.length) {
    return <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>No usage recorded yet.</div>;
  }

  return (
    <div className="space-y-3">
      {entries.map((e) => {
        const pct = grandTotal > 0 ? (e.total / grandTotal) * 100 : 0;
        const color = colorForModel(e.model);
        return (
          <div key={e.model}>
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-2 truncate">
                <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
                <span className="font-medium truncate" style={{ color: 'var(--text-heading)' }} title={e.model}>{e.model}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{e.messages} msgs</span>
                <span className="tabular-nums font-semibold" style={{ color: 'var(--text-heading)' }}>{formatTokens(e.total)}</span>
                <span className="tabular-nums text-[10px]" style={{ color: 'var(--text-secondary)', width: 48, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
              </div>
            </div>
            <div style={{ height: 6, background: 'var(--border-color)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 300ms ease' }} />
            </div>
            <div className="text-[10px] mt-1 flex gap-3" style={{ color: 'var(--text-secondary)' }}>
              <span>in: {formatTokens(e.input)}</span>
              <span>out: {formatTokens(e.output)}</span>
              <span>cache write: {formatTokens(e.cacheCreation)}</span>
              <span>cache read: {formatTokens(e.cacheRead)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectBreakdown({ byProject }) {
  if (!byProject?.length) {
    return <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>No projects.</div>;
  }
  const max = Math.max(...byProject.map((p) => p.totals.total), 1);
  return (
    <div className="space-y-2">
      {byProject.slice(0, 15).map((p) => {
        const pct = (p.totals.total / max) * 100;
        return (
          <div key={p.slug}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium truncate" style={{ color: 'var(--text-heading)' }} title={p.cwd || p.slug}>
                {p.name}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                <span style={{ color: 'var(--text-secondary)' }}>{p.sessions} sessions</span>
                <span className="font-semibold tabular-nums" style={{ color: 'var(--text-heading)' }}>{formatTokens(p.totals.total)}</span>
              </div>
            </div>
            <div style={{ height: 4, background: 'var(--border-color)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#f97316', transition: 'width 300ms ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SessionsTable({ sessions }) {
  if (!sessions?.length) {
    return <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>No sessions found.</div>;
  }
  return (
    <div style={{ maxHeight: 480, overflowY: 'auto' }}>
      <table className="w-full text-xs">
        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
          <tr style={{ color: 'var(--text-secondary)' }}>
            <th className="text-left py-2 px-2 font-medium">Session</th>
            <th className="text-left py-2 px-2 font-medium">Project</th>
            <th className="text-left py-2 px-2 font-medium">Model(s)</th>
            <th className="text-right py-2 px-2 font-medium">Input</th>
            <th className="text-right py-2 px-2 font-medium">Output</th>
            <th className="text-right py-2 px-2 font-medium">Cache R</th>
            <th className="text-right py-2 px-2 font-medium">Total</th>
            <th className="text-right py-2 px-2 font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const models = Object.keys(s.byModel || {});
            return (
              <tr key={s.sessionId} style={{ borderTop: '1px solid var(--border-color)' }}>
                <td className="py-2 px-2 font-mono" style={{ color: 'var(--text-heading)' }}>
                  <div className="flex items-center gap-2">
                    {s.isActive && (
                      <span
                        title="Active in last 5 min"
                        style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }}
                      />
                    )}
                    <span title={s.sessionId}>{s.sessionId.slice(0, 8)}</span>
                  </div>
                </td>
                <td className="py-2 px-2 truncate" style={{ color: 'var(--text-secondary)', maxWidth: 200 }} title={s.cwd || s.projectSlug}>
                  {s.projectName}
                </td>
                <td className="py-2 px-2">
                  <div className="flex flex-wrap gap-1">
                    {models.map((m) => (
                      <span
                        key={m}
                        className="px-1.5 py-0.5 rounded text-[10px]"
                        style={{ background: colorForModel(m) + '22', color: colorForModel(m), border: `1px solid ${colorForModel(m)}55` }}
                        title={m}
                      >
                        {m.replace(/^claude-/, '').replace(/^gemini-/, 'gemini-')}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2 px-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatTokens(s.totals.input)}</td>
                <td className="py-2 px-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatTokens(s.totals.output)}</td>
                <td className="py-2 px-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatTokens(s.totals.cacheRead)}</td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text-heading)' }}>{formatTokens(s.totals.total)}</td>
                <td className="py-2 px-2 text-right" style={{ color: 'var(--text-secondary)' }}>{formatRelative(s.lastTimestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TokenUsagePanel() {
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const safeJson = async (res, label) => {
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const text = await res.text();
        if (text) detail += ` — ${text.slice(0, 200)}`;
      } catch {}
      throw new Error(`${label}: ${detail}`);
    }
    return res.json();
  };

  const load = async () => {
    try {
      const [sumRes, sessRes] = await Promise.all([
        apiFetch('/api/usage/summary'),
        apiFetch('/api/usage/sessions?limit=200'),
      ]);
      const sumJson = await safeJson(sumRes, 'summary');
      const sessJson = await safeJson(sessRes, 'sessions');
      setSummary(sumJson);
      setSessions(sessJson.sessions || []);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  if (loading && !summary) {
    return (
      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Loading token usage…
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="text-sm rounded-lg p-4" style={{ background: '#7f1d1d33', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
        Failed to load usage: {error}
      </div>
    );
  }

  const totals = summary?.totals || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0, messages: 0 };
  const topModel = Object.entries(summary?.byModel || {}).sort((a, b) => b[1].total - a[1].total)[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-heading)' }}>Token Usage</h2>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Reads <code>~/.claude/projects/*/*.jsonl</code> — each Claude Code session = one agent run.
            {lastUpdated && <> · updated {formatRelative(lastUpdated.toISOString())}</>}
            {error && <span style={{ color: '#fca5a5' }}> · refresh error: {error}</span>}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Coins}
          label="Total tokens"
          value={formatTokens(totals.total)}
          subLabel={formatFullNumber(totals.total) + ' all-time'}
          tone="orange"
        />
        <StatCard
          icon={Activity}
          label="Active now"
          value={String(summary?.activeSessionCount || 0)}
          subLabel="updated in last 5 min"
          tone="green"
        />
        <StatCard
          icon={Layers}
          label="Total sessions"
          value={String(summary?.sessionCount || 0)}
          subLabel={`${totals.messages.toLocaleString()} assistant messages`}
          tone="blue"
        />
        <StatCard
          icon={Cpu}
          label="Top model"
          value={topModel ? topModel[0].replace(/^claude-/, '') : '—'}
          subLabel={topModel ? formatTokens(topModel[1].total) + ' tokens' : ''}
          tone="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Tokens by model" icon={Cpu}>
          <ModelBreakdown byModel={summary?.byModel} grandTotal={totals.total} />
        </Card>
        <Card title="Tokens by project" icon={FolderGit2}>
          <ProjectBreakdown byProject={summary?.byProject} />
        </Card>
      </div>

      <Card title={`Sessions (${sessions.length})`} icon={Clock}>
        <SessionsTable sessions={sessions} />
      </Card>
    </div>
  );
}

export default TokenUsagePanel;

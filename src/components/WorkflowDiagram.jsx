import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { Workflow, ArrowRight, Users, GitBranch, Shield, FlaskConical, FileText, CheckCircle2, Network } from 'lucide-react';

const STAGE_DEFS = [
  {
    id: 1,
    title: 'Strategy',
    icon: Workflow,
    team: 'a-team',
    agents: ['keroro'],
    color: '#22c55e',
    desc: 'Receive request, set priority + acceptance criteria',
  },
  {
    id: 2,
    title: 'Design',
    icon: GitBranch,
    team: 'a-team',
    agents: ['pkeng'],
    color: '#14b8a6',
    desc: 'Architecture + split work into parallel chunks',
  },
  {
    id: 3,
    title: 'Build',
    icon: Users,
    team: 'DevInwTeam',
    agents: ['pkeng', 'devslave01', 'devslave02', 'devslave03', 'devslave04', 'devslave05', 'devslave06', 'devslave07'],
    color: '#ef4444',
    desc: '7 implementers in parallel',
  },
  {
    id: 3.5,
    title: 'Review',
    icon: Shield,
    team: 'a-team',
    agents: ['firstkung'],
    color: '#3b82f6',
    desc: 'Gate every PR before tests',
  },
  {
    id: 4,
    title: 'Test',
    icon: FlaskConical,
    team: 'a-team',
    agents: ['bank'],
    color: '#f97316',
    desc: 'Unit + integration + e2e + visual regression',
  },
  {
    id: 5,
    title: 'Summary',
    icon: FileText,
    team: 'a-team',
    agents: ['cin'],
    color: '#ec4899',
    desc: 'Compile results, report back to keroro',
  },
];

function getLatestMessage(allInboxes, team, agent) {
  const inbox = allInboxes?.[team]?.[agent];
  if (!inbox || !Array.isArray(inbox) || inbox.length === 0) return null;
  return inbox.reduce((latest, msg) => {
    if (!latest) return msg;
    return new Date(msg.timestamp) > new Date(latest.timestamp) ? msg : latest;
  }, null);
}

function StageCard({ stage, allInboxes, isLast }) {
  const { id, title, icon: Icon, team, agents, color, desc } = stage;
  const isMulti = agents.length > 1;

  // For multi-agent stages, sum inbox counts; for single, show their latest message
  const stats = useMemo(() => {
    let totalMessages = 0;
    let latestMessage = null;
    for (const agent of agents) {
      const inbox = allInboxes?.[team]?.[agent];
      if (Array.isArray(inbox)) {
        totalMessages += inbox.length;
        const candidate = getLatestMessage(allInboxes, team, agent);
        if (candidate && (!latestMessage || new Date(candidate.timestamp) > new Date(latestMessage.timestamp))) {
          latestMessage = candidate;
        }
      }
    }
    return { totalMessages, latestMessage };
  }, [allInboxes, team, agents]);

  return (
    <>
      <div
        className="rounded-xl p-4 flex-1 min-w-0"
        style={{
          background: 'var(--glass-bg)',
          border: `2px solid ${color}40`,
          borderTop: `4px solid ${color}`,
          minWidth: '180px',
          maxWidth: '260px',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div
            className="rounded-lg p-1.5 flex items-center justify-center"
            style={{ background: `${color}25`, color }}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-mono opacity-60">Stage {id}</div>
            <div className="font-bold text-sm truncate" style={{ color }}>{title}</div>
          </div>
        </div>
        <div className="text-xs opacity-70 mb-2 leading-snug">{desc}</div>
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono opacity-60">{team}</span>
          <span
            className="px-2 py-0.5 rounded-full font-mono"
            style={{ background: `${color}20`, color }}
          >
            {isMulti ? `${agents.length} agents` : agents[0]}
          </span>
        </div>
        <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="text-xs flex items-center justify-between">
            <span className="opacity-60">Messages</span>
            <span className="font-mono font-bold">{stats.totalMessages}</span>
          </div>
          {stats.latestMessage && (
            <div className="text-xs mt-1 opacity-80 truncate" title={stats.latestMessage.summary || stats.latestMessage.text}>
              {(stats.latestMessage.summary || stats.latestMessage.text || '').slice(0, 60)}
            </div>
          )}
        </div>
      </div>
      {!isLast && (
        <div className="flex items-center justify-center shrink-0" aria-hidden="true">
          <ArrowRight className="h-5 w-5 opacity-40" />
        </div>
      )}
    </>
  );
}

StageCard.propTypes = {
  stage: PropTypes.object.isRequired,
  allInboxes: PropTypes.object,
  isLast: PropTypes.bool,
};

export function WorkflowDiagram({ teams = [], allInboxes = {} }) {
  const knownTeamNames = useMemo(() => new Set((teams || []).map(t => t?.name).filter(Boolean)), [teams]);
  const aTeamActive = knownTeamNames.has('a-team');
  const devTeamActive = knownTeamNames.has('DevInwTeam');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Network className="h-5 w-5 text-claude-orange" aria-hidden="true" />
            <h2 className="text-xl font-bold m-0">A-Team Pipeline Workflow</h2>
          </div>
          <p className="text-sm opacity-70 m-0">
            5-stage flow: strategy → design → build → review → test → summary
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="px-3 py-1 rounded-full text-xs font-mono"
            style={{
              background: aTeamActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(120, 120, 120, 0.15)',
              color: aTeamActive ? '#22c55e' : '#888',
              border: aTeamActive ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(120, 120, 120, 0.3)',
            }}
          >
            <CheckCircle2 className="h-3 w-3 inline-block mr-1" aria-hidden="true" />
            a-team {aTeamActive ? 'active' : 'inactive'}
          </span>
          <span
            className="px-3 py-1 rounded-full text-xs font-mono"
            style={{
              background: devTeamActive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(120, 120, 120, 0.15)',
              color: devTeamActive ? '#ef4444' : '#888',
              border: devTeamActive ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(120, 120, 120, 0.3)',
            }}
          >
            <CheckCircle2 className="h-3 w-3 inline-block mr-1" aria-hidden="true" />
            DevInwTeam {devTeamActive ? 'active' : 'inactive'}
          </span>
        </div>
      </div>

      {/* Pipeline */}
      <div
        className="flex items-stretch gap-2 overflow-x-auto pb-4"
        style={{ scrollbarWidth: 'thin' }}
      >
        {STAGE_DEFS.map((stage, idx) => (
          <StageCard
            key={stage.id}
            stage={stage}
            allInboxes={allInboxes}
            isLast={idx === STAGE_DEFS.length - 1}
          />
        ))}
      </div>

      {/* Cross-team handoff indicator */}
      <div
        className="rounded-lg p-3 flex items-start gap-3"
        style={{
          background: 'rgba(20, 184, 166, 0.08)',
          border: '1px solid rgba(20, 184, 166, 0.25)',
        }}
      >
        <Shield className="h-5 w-5 shrink-0 mt-0.5" style={{ color: '#14b8a6' }} aria-hidden="true" />
        <div className="text-sm">
          <div className="font-bold mb-1" style={{ color: '#14b8a6' }}>
            FLOW v4.1 — Cross-team handoff logging required
          </div>
          <div className="opacity-80 leading-relaxed">
            Every dispatch <code>a-team.pkeng → DevInwTeam.*</code> must be logged in inboxes of <strong>both</strong> teams
            (sender + receiver side). PRs missing dual-side evidence are rejected by <code>firstkung</code> review gate.
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="rounded-lg p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--border-color)' }}>
        <div className="text-xs font-bold opacity-70 mb-2 uppercase tracking-wider">Legend</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#22c55e' }} aria-hidden="true" />
            <span>Strategy / Acceptance</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#14b8a6' }} aria-hidden="true" />
            <span>Design / Dispatch</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#ef4444' }} aria-hidden="true" />
            <span>Build (parallel)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#3b82f6' }} aria-hidden="true" />
            <span>Review Gate</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#f97316' }} aria-hidden="true" />
            <span>Test (QA)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#ec4899' }} aria-hidden="true" />
            <span>Summary → Strategy</span>
          </div>
        </div>
      </div>
    </div>
  );
}

WorkflowDiagram.propTypes = {
  teams: PropTypes.array,
  allInboxes: PropTypes.object,
};

export default WorkflowDiagram;

import React, { useRef, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { select, max, scaleSqrt, scaleLinear, zoom, forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY, drag, color, polygonHull, line as d3line, curveCatmullRomClosed } from 'd3';
import { Network } from 'lucide-react';

const TEAM_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#06b6d4',
  '#f97316', '#ec4899', '#eab308', '#ef4444',
  '#6366f1', '#14b8a6',
];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// One node per agent name. Agents that belong to multiple teams (e.g. pkeng in
// both a-team and DevInwTeam) get teams=[...all], are pulled toward the
// midpoint of their team centers, and are included in every team's hull.
export function buildGraph(allInboxes, teams) {
  const nodeMap = new Map();
  const edgeMap = new Map();

  // pairMessages: Map<"from|||to", Array<{ts: string|null}>> — accumulates ALL
  // messages per ordered (from,to) pair across every inbox for spawn derivation.
  const pairMessages = new Map();

  const teamColorMap = new Map();
  (teams || []).forEach((team, idx) => {
    teamColorMap.set(team.name, TEAM_COLORS[idx % TEAM_COLORS.length]);
  });

  const ensureNode = (name, teamName) => {
    let n = nodeMap.get(name);
    if (!n) {
      n = { id: name, name, teams: new Set(), msgCount: 0 };
      nodeMap.set(name, n);
    }
    if (teamName) n.teams.add(teamName);
    return n;
  };

  (teams || []).forEach(team => {
    (team.config?.members || []).forEach(m => {
      if (m.name) ensureNode(m.name, team.name);
    });
  });

  Object.entries(allInboxes || {}).forEach(([teamName, agents]) => {
    if (!teamColorMap.has(teamName)) {
      teamColorMap.set(teamName, TEAM_COLORS[hashStr(teamName) % TEAM_COLORS.length]);
    }

    Object.entries(agents || {}).forEach(([agentName, agentData]) => {
      const toNode = ensureNode(agentName, teamName);

      const messages = Array.isArray(agentData) ? agentData : (agentData?.messages || []);
      messages.forEach(msg => {
        const fromName = msg.from || 'unknown';
        if (fromName === agentName) return;

        // Don't auto-tag `from` with the inbox owner's team — only roster
        // membership counts. system/unknown stay teamless and float.
        const fromNode = ensureNode(fromName, null);

        fromNode.msgCount += 1;
        toNode.msgCount += 1;

        const edgeKey = `${fromName}|||${agentName}`;
        if (edgeMap.has(edgeKey)) {
          edgeMap.get(edgeKey).count += 1;
        } else {
          edgeMap.set(edgeKey, { source: fromName, target: agentName, count: 1, kind: 'message' });
        }

        // Accumulate raw timestamps for spawn derivation below.
        if (!pairMessages.has(edgeKey)) pairMessages.set(edgeKey, []);
        pairMessages.get(edgeKey).push(msg.timestamp || null);
      });
    });
  });

  // Finalize: convert teams Set → sorted array, attach colors.
  const nodes = Array.from(nodeMap.values()).map(n => {
    const teamArr = Array.from(n.teams).sort();
    const colors = teamArr.map(t => teamColorMap.get(t)).filter(Boolean);
    return {
      id: n.id,
      name: n.name,
      teams: teamArr,
      colors,
      primaryColor: colors[0] || '#6b7280',
      msgCount: n.msgCount,
    };
  });
  const edges = Array.from(edgeMap.values());
  const messageEdges = edges; // alias — same array, kept for downstream clarity

  // SPAWN HEURISTIC: first chronological message A->B is treated as the spawn
  // edge. Replace this block when a real spawn event type lands on the WS protocol.
  //
  // Rule: for each ordered (from,to) pair across ALL inboxes, sort the collected
  // timestamps ascending (invalid / missing timestamps fall to the end), then
  // take the minimum valid timestamp. One SpawnEdge per ordered pair.
  const isValidTs = (ts) => {
    if (!ts || typeof ts !== 'string') return false;
    const d = new Date(ts);
    return !isNaN(d.getTime());
  };

  const spawnEdges = [];
  const inByAgent = new Map();
  const outByAgent = new Map();

  pairMessages.forEach((timestamps, edgeKey) => {
    const [src, tgt] = edgeKey.split('|||');
    const validTs = timestamps.filter(isValidTs).sort();
    const firstTs = validTs.length > 0 ? validTs[0] : (timestamps[0] || '');
    spawnEdges.push({ source: src, target: tgt, kind: 'spawn', firstTs });

    outByAgent.set(src, (outByAgent.get(src) || 0) + 1);
    inByAgent.set(tgt, (inByAgent.get(tgt) || 0) + 1);
  });

  const spawnIndex = { inByAgent, outByAgent };

  return { nodes, edges, messageEdges, spawnEdges, spawnIndex, teamColorMap };
}

export function AgentNetworkGraph({ allInboxes = {}, teams = [] }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [selectedAgentId, setSelectedAgentId] = useState(null);

  const { nodes, edges, messageEdges, spawnEdges, spawnIndex, teamColorMap } = useMemo(
    () => buildGraph(allInboxes, teams),
    [allInboxes, teams]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) {
          setDimensions({ width, height: Math.max(400, Math.min(width * 0.6, 600)) });
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Reset selection when the set of node ids changes so stale selections don't
  // survive a roster swap. Compare by serializing sorted id list to a string.
  const nodeIdsKey = useMemo(() => nodes.map(n => n.id).sort().join('|'), [nodes]);
  useEffect(() => {
    setSelectedAgentId(null);
  }, [nodeIdsKey]);

  // Clear selection on Escape — remove the listener on cleanup to avoid leaks.
  useEffect(() => {
    if (selectedAgentId === null) return;
    const handler = (e) => {
      if (e.key === 'Escape') setSelectedAgentId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedAgentId]);

  useEffect(() => {
    if (nodes.length === 0) return;

    const svg = select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;

    const maxMsg = Math.max(1, max(nodes, d => d.msgCount) || 1);
    const radiusScale = scaleSqrt().domain([0, maxMsg]).range([8, 24]);

    const maxEdge = Math.max(1, max(messageEdges, d => d.count) || 1);
    const edgeWidthScale = scaleLinear().domain([1, maxEdge]).range([1.5, 6]);

    // Per-team cluster centers — laid out on a circle around the canvas center.
    // A node belonging to multiple teams is included in EVERY team's member list
    // (so each hull encloses it) but its target position is the midpoint of all
    // its team centers (so it sits on the boundary between them).
    const teamNames = new Set();
    nodes.forEach(n => n.teams.forEach(t => teamNames.add(t)));
    const teamList = Array.from(teamNames).sort().map(name => ({
      name,
      color: teamColorMap.get(name) || '#6b7280',
      members: [],
    }));
    const clusterRadius = Math.min(width, height) * 0.28;
    teamList.forEach((team, i) => {
      if (teamList.length === 1) {
        team.cx = width / 2;
        team.cy = height / 2;
      } else {
        const angle = (i / teamList.length) * 2 * Math.PI - Math.PI / 2;
        team.cx = width / 2 + Math.cos(angle) * clusterRadius;
        team.cy = height / 2 + Math.sin(angle) * clusterRadius;
      }
    });
    const teamCenterById = new Map(teamList.map(t => [t.name, t]));
    nodes.forEach(n => {
      n.teams.forEach(t => teamCenterById.get(t)?.members.push(n));
    });

    // Target position for a node = average of its team centers (so multi-team
    // agents land between their teams' clusters).
    const targetXY = (n) => {
      if (!n.teams || n.teams.length === 0) return { x: width / 2, y: height / 2 };
      let sx = 0, sy = 0, k = 0;
      n.teams.forEach(t => {
        const c = teamCenterById.get(t);
        if (c) { sx += c.cx; sy += c.cy; k++; }
      });
      return k ? { x: sx / k, y: sy / k } : { x: width / 2, y: height / 2 };
    };

    // Clear selection when clicking on the SVG background (not a node).
    svg.on('click', () => setSelectedAgentId(null));

    const g = svg.append('g');

    const zoomBehavior = zoom()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoomBehavior);

    // Hulls render under everything else — append the layer first.
    const hullLayer = g.append('g').attr('class', 'team-hulls');
    const teamLabelLayer = g.append('g').attr('class', 'team-labels');

    const simulation = forceSimulation(nodes)
      .force('link', forceLink(messageEdges).id(d => d.id).distance(80).strength(0.4))
      .force('charge', forceManyBody().strength(-220))
      .force('x', forceX(d => targetXY(d).x).strength(0.25))
      .force('y', forceY(d => targetXY(d).y).strength(0.25))
      .force('collide', forceCollide().radius(d => radiusScale(d.msgCount) + 12));

    // Arrow markers — solid for message edges, same style for spawn edges
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#6b7280');

    defs.append('marker')
      .attr('id', 'arrowhead-spawn')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#9ca3af');

    // Spawn edges layer (dashed) — rendered below message edges
    const spawnLinkGroup = g.append('g');
    const spawnLink = spawnLinkGroup
      .selectAll('line')
      .data(spawnEdges, d => `${d.source}|||${d.target}`)
      .join(
        enter => enter.append('line')
          .attr('stroke', '#6b7280')
          .attr('stroke-opacity', 0)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '6 4')
          .attr('marker-end', 'url(#arrowhead-spawn)')
          .call(sel => sel.transition().duration(300).attr('stroke-opacity', 0.5)),
        update => update.call(sel => sel.transition().duration(300)
          .attr('stroke-width', 1.5)),
        exit => exit.call(sel => sel.transition().duration(300)
          .attr('stroke-opacity', 0)
          .remove())
      );

    // Message edges layer (solid) — rendered above spawn edges
    const link = g.append('g')
      .selectAll('line')
      .data(messageEdges, d => `${d.source}|||${d.target}`)
      .join(
        enter => enter.append('line')
          .attr('stroke', '#4b5563')
          .attr('stroke-opacity', 0)
          .attr('stroke-width', d => edgeWidthScale(d.count))
          .attr('marker-end', 'url(#arrowhead)')
          .call(sel => sel.transition().duration(300).attr('stroke-opacity', 0.6)),
        update => update.call(sel => sel.transition().duration(300)
          .attr('stroke-width', d => edgeWidthScale(d.count))),
        exit => exit.call(sel => sel.transition().duration(300)
          .attr('stroke-opacity', 0)
          .remove())
      );

    const edgeLabels = g.append('g')
      .selectAll('text')
      .data(edges)
      .join('text')
      .attr('fill', '#9ca3af')
      .attr('font-size', '10px')
      .attr('text-anchor', 'middle')
      .attr('dy', -4)
      .text(d => d.count > 1 ? d.count : '');

    const node = g.append('g')
      .selectAll('g')
      .data(nodes, d => d.id)
      .join(
        enter => enter.append('g').attr('opacity', 0)
          .attr('tabindex', 0)
          .attr('role', 'button')
          .attr('aria-label', d => `Agent ${d.name || d.id}${d.teams?.length ? ' on ' + d.teams.join(', ') : ''} — press Enter to view inbox`)
          .style('outline', 'none')
          .on('keydown', (event, d) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSelectedAgentId(d.id);
            }
          })
          .on('focus', function () {
            select(this).select('circle.body').attr('stroke-width', 4);
          })
          .on('blur', function () {
            select(this).select('circle.body').attr('stroke-width', 2);
          })
          .call(sel => sel.transition().duration(300).attr('opacity', 1)),
        update => update.call(sel => sel.transition().duration(300).attr('opacity', 1))
          .attr('aria-label', d => `Agent ${d.name || d.id}${d.teams?.length ? ' on ' + d.teams.join(', ') : ''} — press Enter to view inbox`),
        exit => exit.call(sel => sel.transition().duration(300)
          .attr('opacity', 0)
          .remove())
      )
      .call(drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );

    // Body circle — filled with the primary team color.
    // On enter the 'g' opacity is already animated; here we also animate the
    // circle radius so that updated nodes smoothly grow/shrink (update selection).
    node.selectAll('circle.body')
      .data(d => [d], d => d.id)
      .join(
        enter => enter.append('circle')
          .attr('class', 'body')
          .attr('r', d => radiusScale(d.msgCount))
          .attr('fill', d => d.primaryColor)
          .attr('fill-opacity', 0.85)
          .attr('stroke', d => color(d.primaryColor).brighter(0.8))
          .attr('stroke-width', 2)
          .style('cursor', 'pointer')
          .on('click', (event, d) => {
            event.stopPropagation();
            setSelectedAgentId(d.id);
          }),
        update => update.call(sel => sel.transition().duration(300)
          .attr('r', d => radiusScale(d.msgCount))
          .attr('fill', d => d.primaryColor)
          .attr('stroke', d => color(d.primaryColor).brighter(0.8)))
      );

    // Multi-team agents get a second outer ring in the secondary team color,
    // so it's obvious at a glance that the node bridges two teams.
    node.filter(d => (d.colors?.length || 0) >= 2)
      .append('circle')
      .attr('r', d => radiusScale(d.msgCount) + 4)
      .attr('fill', 'none')
      .attr('stroke', d => d.colors[1])
      .attr('stroke-width', 2.5)
      .attr('stroke-dasharray', '3 2')
      .style('pointer-events', 'none');

    node.append('title')
      .text(d => {
        const teamLine = d.teams && d.teams.length
          ? (d.teams.length > 1 ? `Teams (multi): ${d.teams.join(', ')}` : `Team: ${d.teams[0]}`)
          : 'Team: (unaffiliated)';
        return `${d.name}\n${teamLine}\nMessages: ${d.msgCount}`;
      });

    // Show labels for nodes with enough space
    node.append('text')
      .attr('dy', d => radiusScale(d.msgCount) + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', '#d1d5db')
      .attr('font-size', '11px')
      .attr('font-weight', 500)
      .attr('pointer-events', 'none')
      .text(d => {
        const name = d.name || d.id;
        return name.length > 14 ? name.slice(0, 12) + '..' : name;
      });

    const hullLine = d3line().curve(curveCatmullRomClosed.alpha(0.8));

    // Pad points around each node so the hull surrounds, not bisects, the circles.
    const padHullPoints = (members) => {
      const pts = [];
      const pad = 28;
      members.forEach(m => {
        if (m.x == null || m.y == null) return;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * 2 * Math.PI;
          pts.push([m.x + Math.cos(a) * pad, m.y + Math.sin(a) * pad]);
        }
      });
      return pts;
    };

    const renderHulls = () => {
      const hullData = teamList
        .map(t => {
          const pts = padHullPoints(t.members);
          if (pts.length < 3) return null;
          const hull = polygonHull(pts);
          if (!hull) return null;
          const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
          const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
          return { team: t, hull, cx, cy };
        })
        .filter(Boolean);

      const paths = hullLayer.selectAll('path').data(hullData, d => d.team.name);
      paths.exit().remove();
      const pathsEnter = paths.enter().append('path')
        .attr('fill-opacity', 0.12)
        .attr('stroke-opacity', 0.55)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4 3');
      pathsEnter.merge(paths)
        .attr('fill', d => d.team.color)
        .attr('stroke', d => d.team.color)
        .attr('d', d => hullLine(d.hull));

      const labels = teamLabelLayer.selectAll('g').data(hullData, d => d.team.name);
      labels.exit().remove();
      const labelsEnter = labels.enter().append('g').attr('pointer-events', 'none');
      labelsEnter.append('rect')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('fill', 'rgba(15, 23, 42, 0.85)')
        .attr('stroke-width', 1);
      labelsEnter.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '12px')
        .attr('font-weight', 700)
        .attr('letter-spacing', '0.5px');

      const merged = labelsEnter.merge(labels);
      merged.attr('transform', d => {
        // Anchor label to top of hull so it doesn't sit on top of nodes.
        const topY = Math.min(...d.hull.map(p => p[1]));
        return `translate(${d.cx}, ${topY - 14})`;
      });
      merged.select('text')
        .attr('fill', d => d.team.color)
        .text(d => `${d.team.name} (${d.team.members.length})`);
      merged.select('rect')
        .attr('stroke', d => d.team.color)
        .each(function(d) {
          const text = select(this.parentNode).select('text').node();
          if (!text) return;
          const bbox = text.getBBox();
          select(this)
            .attr('x', bbox.x - 6)
            .attr('y', bbox.y - 3)
            .attr('width', bbox.width + 12)
            .attr('height', bbox.height + 6);
        });
    };

    // Build a node-position lookup for spawn edges (which are not in the force
    // simulation's link force — they use the same x/y but aren't structurally linked).
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      // Spawn edges reference agent IDs (strings) not force-simulation objects,
      // so we look up positions from the node map.
      spawnLink
        .attr('x1', d => { const n = nodeById.get(d.source); return n ? n.x : 0; })
        .attr('y1', d => { const n = nodeById.get(d.source); return n ? n.y : 0; })
        .attr('x2', d => { const n = nodeById.get(d.target); return n ? n.x : 0; })
        .attr('y2', d => { const n = nodeById.get(d.target); return n ? n.y : 0; });

      edgeLabels
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2);

      node.attr('transform', d => `translate(${d.x},${d.y})`);

      renderHulls();
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, messageEdges, spawnEdges, dimensions]);

  // Collect unique teams for legend, plus flag any multi-team agents so the
  // user knows what the dashed outer ring means.
  const teamLegend = useMemo(() => {
    const entries = [];
    const seen = new Set();
    nodes.forEach(n => n.teams.forEach(t => {
      if (!seen.has(t)) {
        seen.add(t);
        entries.push([t, teamColorMap?.get(t) || n.primaryColor]);
      }
    }));
    return entries.sort((a, b) => a[0].localeCompare(b[0]));
  }, [nodes, teamColorMap]);

  const hasMultiTeam = useMemo(() => nodes.some(n => (n.teams?.length || 0) >= 2), [nodes]);

  // Derive the detail payload for the currently selected agent.
  const agentDetail = useMemo(() => {
    if (!selectedAgentId) return null;
    const node = nodes.find(n => n.id === selectedAgentId);
    if (!node) return null;

    // Collect all messages across every inbox where the agent is either the
    // inbox owner (incoming) or the `from` (outgoing). Tag each with `to` =
    // the inbox owner so the UI can display "from → to".
    const allMessages = [];
    Object.entries(allInboxes || {}).forEach(([_teamName, agents]) => {
      Object.entries(agents || {}).forEach(([agentName, agentData]) => {
        const messages = Array.isArray(agentData) ? agentData : (agentData?.messages || []);
        messages.forEach(msg => {
          const fromName = msg.from || 'unknown';
          // Include if the selected agent is the inbox owner (incoming) OR the sender (outgoing).
          if (agentName === selectedAgentId || fromName === selectedAgentId) {
            // Avoid double-counting self-messages (from === agentName already filtered in buildGraph).
            if (fromName !== agentName) {
              allMessages.push({
                from: fromName,
                to: agentName,
                text: msg.text || '',
                timestamp: msg.timestamp || '',
                summary: msg.summary,
              });
            }
          }
        });
      });
    });

    // Sort by timestamp descending (most recent first), missing timestamps sort last.
    allMessages.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      if (isNaN(ta) && isNaN(tb)) return 0;
      if (isNaN(ta)) return 1;
      if (isNaN(tb)) return -1;
      return tb - ta;
    });

    // Deduplicate: if the same physical message appears in multiple inbox traversals
    // (e.g., sender's perspective and receiver's perspective are both included above),
    // we may get duplicates. Use a Set keyed by from+to+timestamp+text.
    const seen = new Set();
    const uniqueMessages = allMessages.filter(m => {
      const key = `${m.from}|||${m.to}|||${m.timestamp}|||${m.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      name: node.name,
      teams: node.teams,
      msgCount: node.msgCount,
      spawnIn: spawnIndex.inByAgent.get(selectedAgentId) || 0,
      spawnOut: spawnIndex.outByAgent.get(selectedAgentId) || 0,
      lastMessages: uniqueMessages.slice(0, 5),
    };
  }, [selectedAgentId, allInboxes, spawnIndex, nodes]);

  // Format a timestamp as a relative human-readable string (e.g. "3m ago").
  const relativeTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return 'just now';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  };

  const hasData = nodes.length > 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-claude-orange" />
          <h3 className="text-lg font-semibold text-white">Agent Network Graph</h3>
        </div>
        {hasData && (
          <span className="text-xs text-gray-400">
            {nodes.length} agents, {edges.length} connections
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="flex items-center text-gray-400" style={{ flexDirection: 'column', justifyContent: 'center', paddingTop: '64px', paddingBottom: '64px' }}>
          <Network className="mb-3" style={{ height: '64px', width: '64px', opacity: 0.4 }} />
          <p className="text-sm">No agent communication data yet</p>
          <p className="text-xs mt-1 text-gray-500">Connections will appear as agents exchange messages</p>
        </div>
      ) : (
        <>
          <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
            <svg
              ref={svgRef}
              width={dimensions.width}
              height={dimensions.height}
              style={{
                width: '100%',
                height: dimensions.height,
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.4)',
                border: '1px solid rgba(55, 65, 81, 0.4)',
              }}
            />
          </div>

          {/* Inline agent detail panel — shown when a node is selected */}
          {selectedAgentId && agentDetail && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(55, 65, 81, 0.6)',
              }}
              data-testid="agent-detail-panel"
            >
              {/* Header row */}
              <div className="flex items-center justify-between" style={{ marginBottom: '10px' }}>
                <h4 className="text-white font-semibold" style={{ fontSize: '14px' }}>
                  {agentDetail.name}
                </h4>
                <button
                  aria-label="Close detail panel"
                  onClick={() => setSelectedAgentId(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#9ca3af',
                    fontSize: '16px',
                    lineHeight: 1,
                    padding: '2px 4px',
                  }}
                >
                  ×
                </button>
              </div>

              {/* Stats row */}
              <div className="flex flex-wrap gap-4" style={{ marginBottom: '10px' }}>
                <div>
                  <span className="text-xs text-gray-500">Teams</span>
                  <p className="text-xs text-gray-300">
                    {agentDetail.teams.length > 0 ? agentDetail.teams.join(', ') : '(none)'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-500">Messages</span>
                  <p className="text-xs text-gray-300">{agentDetail.msgCount}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-500">Spawn in</span>
                  <p className="text-xs text-gray-300">{agentDetail.spawnIn}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-500">Spawn out</span>
                  <p className="text-xs text-gray-300">{agentDetail.spawnOut}</p>
                </div>
              </div>

              {/* Last messages */}
              {agentDetail.lastMessages.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(55, 65, 81, 0.5)', paddingTop: '8px' }}>
                  <span className="text-xs text-gray-500" style={{ display: 'block', marginBottom: '6px' }}>
                    Recent messages
                  </span>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {agentDetail.lastMessages.map((msg, idx) => (
                      <li key={idx} style={{ padding: '6px 8px', background: 'rgba(30, 41, 59, 0.6)', borderRadius: '6px' }}>
                        <div className="flex items-center justify-between" style={{ marginBottom: '2px' }}>
                          <span className="text-xs text-gray-400">
                            <span style={{ color: '#d1d5db' }}>{msg.from}</span>
                            {' → '}
                            <span style={{ color: '#d1d5db' }}>{msg.to}</span>
                          </span>
                          <span className="text-xs text-gray-500">{relativeTime(msg.timestamp)}</span>
                        </div>
                        <p className="text-xs text-gray-300" style={{ margin: 0, wordBreak: 'break-word' }}>
                          {msg.text.length > 140 ? msg.text.slice(0, 140) + '…' : msg.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Legend */}
          {teamLegend.length > 0 && (
            <div className="flex flex-wrap gap-4 mt-4" style={{ paddingTop: '12px', borderTop: '1px solid rgba(55, 65, 81, 0.6)' }}>
              <span className="text-xs text-gray-500 font-medium" style={{ marginRight: '4px' }}>Teams:</span>
              {teamLegend.map(([teamName, teamColor]) => (
                <div key={teamName} className="flex items-center" style={{ gap: '6px' }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: teamColor,
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span className="text-xs text-gray-300">{teamName}</span>
                </div>
              ))}
              {hasMultiTeam && (
                <div className="flex items-center" style={{ gap: '6px', marginLeft: '8px' }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: '2px dashed #d1d5db',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span className="text-xs text-gray-400">dashed ring = belongs to multiple teams</span>
                </div>
              )}
            </div>
          )}

          {/* Edge type legend */}
          <div className="flex flex-wrap gap-4 mt-2" style={{ paddingTop: '8px' }}>
            <span className="text-xs text-gray-500 font-medium" style={{ marginRight: '4px' }}>Edges:</span>
            {/* Solid swatch — message */}
            <div className="flex items-center" style={{ gap: '6px' }}>
              <svg width="24" height="10" aria-hidden="true">
                <line x1="0" y1="5" x2="24" y2="5" stroke="#4b5563" strokeWidth="2.5" />
              </svg>
              <span className="text-xs text-gray-300">message</span>
            </div>
            {/* Dashed swatch — spawn */}
            <div className="flex items-center" style={{ gap: '6px' }}>
              <svg width="24" height="10" aria-hidden="true">
                <line x1="0" y1="5" x2="24" y2="5" stroke="#6b7280" strokeWidth="2" strokeDasharray="6 4" />
              </svg>
              <span className="text-xs text-gray-300">spawn (first msg)</span>
            </div>
          </div>

          <p className="text-xs text-gray-500 mt-2">
            Drag nodes to rearrange. Scroll to zoom. Edge width indicates message volume.
          </p>
        </>
      )}
    </div>
  );
}

AgentNetworkGraph.propTypes = {
  allInboxes: PropTypes.object,
  teams: PropTypes.array,
};

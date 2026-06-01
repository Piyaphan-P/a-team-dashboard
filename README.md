# A-Team Dashboard

Real-time monitoring dashboard for [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) agent teams. WebSocket streaming, no polling, no config.

[![npm](https://img.shields.io/npm/v/@piyaphan-p/a-team-dashboard.svg)](https://www.npmjs.com/package/@piyaphan-p/a-team-dashboard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

## What it does

Watches `~/.claude/teams/`, `~/.claude/tasks/`, and `/tmp/claude/*/tasks/` and streams every change to a browser UI in real time.

- **Teams & inboxes** — see which agent is doing what, and read inter-agent messages
- **Tasks** — live status, dependencies, completion rate
- **Activity timeline** — every agent event, timestamped and filterable
- **Token usage** — per-session token tracker
- **Logs viewer** — server activity log with filters and export
- **Archive** — completed teams are auto-archived to `~/.claude/archive/` with a summary

## Quick start

```bash
npx @piyaphan-p/a-team-dashboard
```

Or install globally:

```bash
npm install -g @piyaphan-p/a-team-dashboard
a-team-dashboard
```

Open <http://localhost:3001>. First run prompts you to set a password — it's stored as an `scrypt` hash in `~/.claude/dashboard.key`.

## From source

```bash
git clone https://github.com/Piyaphan-P/a-team-dashboard.git
cd a-team-dashboard
npm install
npm run build
npm start
```

Dev mode (hot reload):

```bash
npm run server    # terminal 1
npm run dev       # terminal 2
```

## Stack

React 19 · Vite 7 · Node 18+ · Express · `ws` · Chokidar · Vitest · Playwright

## Architecture

```
Browser (React + WS client)
        ↕  WebSocket
Node server (Express + ws + chokidar)
        ↕  fs watch
~/.claude/{teams,tasks,archive}
/tmp/claude/{project}/tasks/
```

The dashboard is **read-only** for Claude Code state — it never writes to your teams or tasks (only to its own archive directory).

## API

| Endpoint | Description |
|---|---|
| `GET /api/teams` | list active teams |
| `GET /api/teams/:team/inboxes` | all agent inboxes for a team |
| `GET /api/teams/:team/inboxes/:agent` | one agent's inbox |
| `GET /api/inboxes` | snapshot of every team's inboxes |
| `GET /api/archive` | list archived teams |
| `GET /api/archive/:filename` | full archive payload |
| `GET /api/team-history` | active + completed teams, sorted by last-modified |
| `GET /api/logs` | server activity log with filters |

WebSocket: connect to `ws://localhost:3001/?token=<token>`. Emits `initial_data`, `inbox_update`, `task_update`, `team_update`.

## Security

- Password required on every load (scrypt with OWASP params, timing-safe compare)
- 256-bit token rotated on each login; 5 attempts / IP / 15 min
- Strict CSP, HSTS, CORP, COOP, Permissions-Policy via Helmet
- CORS pinned to `localhost:3001` / `localhost:5173`
- Every route param passes an allowlist sanitizer; exact-match check rejects partial encoding
- WebSocket: token required, 30 s heartbeat, 50 msg/s, 64 KB max frame
- `followSymlinks: false` on every chokidar watcher
- `path.resolve()` validation on every fs call

## Configuration

Server config in `config.js`. Common knobs:

```js
{
  port: 3001,
  watchOptions: {
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: 1000,
    depth: 10,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  }
}
```

## Testing

```bash
npm test              # vitest (unit)
npm run test:e2e      # playwright
```

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). For bugs and feature requests, open an [issue](https://github.com/Piyaphan-P/a-team-dashboard/issues).

## Credits

Originally forked from [mukul975/claude-team-dashboard](https://github.com/mukul975/claude-team-dashboard). A-Team edition rebuilt and maintained by [Piyaphan.Po](https://github.com/Piyaphan-P).

## License

[MIT](LICENSE)

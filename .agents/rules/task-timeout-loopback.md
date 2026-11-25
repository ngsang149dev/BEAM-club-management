
# Task Timeout & Loopback Watchdog

Prevent background commands, builds, E2E runs, and subagents from hanging indefinitely in the Windows, macOS, or Linux sandbox or CI environment by pairing every long-running invocation with an explicit timeout watchdog and an automatic kill-and-loopback protocol.

## 1. Mandatory `NotificationTimeoutSeconds` on Non-Daemon `run_command`

Always set `NotificationTimeoutSeconds` on every expected-to-terminate `run_command` call (never on `IsDaemon: true` servers):

| Workload | `NotificationTimeoutSeconds` | Notes |
|---|---|---|
| Fast checks (`typecheck`, `lint`, `arch:check`, `openapi:check`, `test:unit`, `db:migrate`, `db:seed`) | `60` | Fails or completes well within 1 minute. |
| Production build & DB integration (`npm run build`, `npm run test:integration`) | `90` | Triggers early if PostgreSQL (`5432`) or Turbopack hangs. |
| Playwright E2E — sandboxed attempt (`npm run test:e2e`) | `25` | Fast stall detection when `[WebServer]` cannot bind/probe `127.0.0.1:3001` inside a sandbox. |
| Playwright E2E — unsandboxed (`BypassSandbox: true`) | `150` | Real Chrome sequential suite typically finishes in ~70–90s. |

Always pass identical `toolSummary` when retrying a blocked command with `BypassSandbox: true`.

## 2. Automatic Timeout Check & Loopback Protocol

When a `NotificationTimeoutSeconds` notification fires:

1. Call `manage_task(Action: "status", TaskId: ...)` once to inspect recent output and elapsed idle time.
2. **If stalled (`>= 25–30s` with no forward progress) or blocked by sandbox signature** (`[WebServer]` waiting on `127.0.0.1`, `EACCES`, `EPERM` on `127.0.0.1`/PostgreSQL, `operation not permitted` on `docker.sock`, Turbopack junction `os error 5`, `.git/index.lock`):
   - Call `manage_task(Action: "kill", TaskId: ...)` immediately.
   - Diagnose and **loop back** cleanly (e.g., re-run with `BypassSandbox: true` using the exact same `toolSummary`, free locked resources, or fix the failing test/command).
3. **If actively making forward progress** (new passing test lines recently logged):
   - Allow it to continue and optionally set a bounded follow-up timer via `schedule(DurationSeconds: 120, TimerCondition: <taskId>)` rather than polling.
4. **Retry Cap (`AGENTS.md` §4):**
   - Limit automatic loopbacks to **2 retries (3 total attempts)**. If still stuck or failing after 3 attempts, stop and report the exact failure/log tail to the project owner rather than looping further.

## 3. Subagent Watchdog

When dispatching long-running subagents (`qa-engineer`, `backend-db`, `frontend`), optionally pair them with `schedule(DurationSeconds: 300, TimerCondition: <conversationId>, Prompt: "Check if subagent <id> is stalled or needs guidance.")` so a stalled subagent triggers an automatic status check, follow-up message, or re-dispatch rather than silent waiting.

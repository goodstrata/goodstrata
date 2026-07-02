# GoodStrata

**Your owners corporation, run by AI agents. Humans only decide.**

GoodStrata is an open-source, fully agentic strata (owners corporation) management platform, built first for Victoria, Australia (Owners Corporations Act 2006). Agents execute the operational work — levy notices, payment reconciliation, arrears follow-up, maintenance triage and contractor dispatch, meeting notices and minutes — while committee members and owners only ever **approve, vote, or escalate** through a decisions inbox. Every action lands on an append-only event bus, so the whole "manager" is auditable down to each model tool-call.

- **Self-host floor:** PostgreSQL + one Node process. Every paid integration has an offline default; local LLMs work via Ollama.
- **Managed service:** [goodstrata.com.au](https://goodstrata.com.au) — same code, hosted, with real payments (Monoova NPP/PayID) and Claude.
- **License:** Apache-2.0

## The design in one paragraph

Domain writes and their events commit in one transaction to an append-only `event_log` (the audit spine). A cursor-tailing dispatcher — woken by `LISTEN/NOTIFY`, guaranteed by catch-up scans — fans events out to pg-boss queues, where each domain agent (finance, maintenance, meetings) runs an AI-SDK tool loop with a crash-safe transcript. Agents call the same service layer the API uses; **money math is never done by the LLM** — levy apportionment, penalty interest, reconciliation matching, and entitlement-weighted voting are deterministic, exhaustively-tested engines. Anything consequential goes through a **decision gate**: the agent proposes with evidence, a human approves in the app, and a code executor performs exactly the approved action.

## Quick start

Prereqs: Node ≥ 22, pnpm 9, Docker.

```bash
git clone https://github.com/goodstrata/goodstrata && cd goodstrata
docker compose up -d            # Postgres 18 on :5434
pnpm install

# Seed the demo scheme (12-lot Fitzroy walk-up, mid-story)
DATABASE_URL=postgres://goodstrata:goodstrata@localhost:5434/goodstrata \
BETTER_AUTH_SECRET=dev-secret-0123456789abcdef \
pnpm seed:demo

# Terminal 1 — API + event dispatcher + agents (:3000)
DATABASE_URL=postgres://goodstrata:goodstrata@localhost:5434/goodstrata \
BETTER_AUTH_SECRET=dev-secret-0123456789abcdef \
pnpm --filter @goodstrata/api dev

# Terminal 2 — web app (:5173, proxies /api)
pnpm --filter @goodstrata/web dev
```

Sign in at http://localhost:5173 with **demo@goodstrata.local / goodstrata-demo**.

### What you'll see

The demo seeds a story in progress: *48 Rose St Owners Corporation*, 12 lots, adopted budget, Q1 levies issued — 11 owners paid, **lot 7 is 47 days in arrears**, and there's an untriaged "water stain on lot 9 ceiling" maintenance request. The moment the API boots, the dispatcher catches up on the event log and the agents go to work — check the **Agents** tab for their tool-call transcripts, **Decisions** for anything they've escalated, and **Activity** for the live event feed. On the Finance tab you can issue the next instalment and click *Simulate payment* to watch a signed webhook reconcile in real time.

By default `AI_PROVIDER=mock` (no API key needed; agents acknowledge but don't reason). For the real thing:

```bash
AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-…      # hosted models
AI_PROVIDER=local OLLAMA_BASE_URL=http://localhost:11434 AI_DEFAULT_MODEL=local:qwen3:14b   # local models
```

### Single-container self-host

```bash
docker compose --profile app up --build    # Postgres + everything on :3000
```

## Architecture

```
apps/
  api/            Hono API + better-auth + SSE + pg-boss workers + dispatcher (one process)
  web/            React PWA — Vite, TanStack Router/Query, Tailwind v4
packages/
  shared/         money (integer cents, largest-remainder), clock, enums, CSV
  db/             Drizzle schema (~48 tables) + versioned SQL migrations
  events/         typed event catalog, transactional publish, dispatcher
  core/           THE service layer + deterministic engines (levy, interest,
                  reconcile, arrears ladder, voting) — API routes and agent
                  tools call the same functions
  agents/         AI SDK v7 tool-loop runtime, agent definitions, mock-model
                  test harness
  integrations/   payments/email/sms/storage drivers with offline defaults
```

Key invariants:

- **Event log is append-only** (database trigger), every mutation publishes in-transaction, and every event carries actor + correlation/causation ids — agent chains are fully traceable and loop-capped.
- **Agents are idempotent** under queue retries: runs are keyed by (trigger event, agent, attempt), tool emissions carry dedupe keys.
- **s 89, quorum, 75% special resolutions, the 14-day notice rule, the 60-day arrears gate** — statutory mechanics are code with exhaustive unit tests, never prompt text.

## Testing

```bash
pnpm test        # unit + integration (spins isolated DBs; uses :5434 or testcontainers)
pnpm test:e2e    # Playwright: full journey — onboarding → money loop → maintenance → AGM
pnpm lint && pnpm typecheck
```

Agent behaviour is tested deterministically with a scripted mock model driving the real tool loop against a real database — zero API calls in CI.

## Status & roadmap

Working today: onboarding (lots CSV, invites, committee, insurance gate) · budgets → levy runs → PayID-style reconciliation → receipts → arrears ladder → committee recovery gate · maintenance triage → threshold-routed work orders · AGM notices, proxies, weighted voting with s 89 · minutes drafting · agent console.

Next: Monoova production driver · AP invoice capture + payout runs · OC certificates (s 151) · compliance calendar + AGM-due nudges · decision timeout escalation ladders · push notifications · NSW/QLD rule packs.

## Contributing

Issues and PRs welcome. The spec that drives scope lives in `docs/` (Victorian OC Act first). Run the demo, break it, tell us.

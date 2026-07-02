# GoodStrata

Open-source, AI-agent-run owners corporation (strata) management. Agents execute the operational work — levy notices, arrears, maintenance dispatch, meeting prep, compliance — and humans only decide: approve, vote, escalate. Every action is recorded on an audited event bus.

- **Self-host floor:** PostgreSQL + one Node process. Local LLMs via Ollama supported.
- **Managed service:** [goodstrata.com.au](https://goodstrata.com.au)
- **License:** Apache-2.0

> Status: active rebuild. See `docs/` and the demo instructions below as slices land.

## Quick start (dev)

```bash
docker compose up -d          # Postgres 18 on :5433
pnpm install
pnpm db:migrate
pnpm dev                      # API :3000, web :5173
```

Full README with demo walkthrough coming with the packaging slice.

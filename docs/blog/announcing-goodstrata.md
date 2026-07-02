# Your strata manager is now an open-source AI agent. It ran our building from a MacBook.

*July 2026 · the GoodStrata team*

Every apartment owner in Australia pays a strata manager — typically $300–$600 per lot, per year — for work that is mostly administration: issue the levies, chase the arrears, book the plumber, send the AGM notice, take the minutes. The work matters enormously and is done indifferently, because the incentives are wrong: managers earn commissions on the insurance they place and the contractors they choose, and the owners footing the bill can't see any of it.

**GoodStrata** is our answer: an open-source platform where AI agents do all of that work, and the humans in the building do the only thing that should ever have been theirs to do — **decide**. Approve the budget. Approve the quote. Vote at the AGM. Everything else runs itself, and every single action lands on an append-only event log you can audit down to the individual model tool-call.

It's free for owners corporations. Not freemium — free. The platform earns a payment-processing margin when levies move and a commission from contractors who win work through it. No subscriptions, no lock-in, and because it's Apache-2.0 open source, "no lock-in" is a checkable claim: self-host it with nothing but PostgreSQL and one Node process.

## We ran a whole building on a laptop, with no cloud AI

The obvious objection to an AI strata manager is trust. So we built for the most paranoid deployment first: **everything local**. To prove it, we seeded a realistic building — *48 Rose St, Fitzroy*, a 12-lot walk-up with an adopted $60k budget, quarterly levies issued, 11 owners paid up, one owner 47 days in arrears, and a fresh "water stain on the lot 9 ceiling" report — and pointed the agents at **Qwen3-30B-A3B running in Ollama on a single MacBook (M4 Max)**. No API key. No data leaving the machine.

Here's the timelapse of what happened when the platform booted.

### T+0:00 — the dispatcher wakes the agents

The event bus (plain Postgres — an append-only log with `LISTEN/NOTIFY`) replays anything the agents haven't seen. Three of them go to work simultaneously.

### T+1:38 — the meetings agent drafts minutes, and refuses to make things up

Last year's AGM record had no attendance entered. The drafted minutes:

> **Quorum:** Not achieved (0/130 entitlements represented).
> **Business transacted:** None. The meeting was adjourned due to lack of quorum.

A 30B local model, given the chance to invent attendees and motions, wrote *"business transacted: none"* — because the structured record it was handed said so, and the prompt says minutes record facts. This is the design everywhere: **the model narrates; the ledger is the truth.**

### T+2:21 — the finance agent chases the arrears, with figures it cannot get wrong

Lot 7 is 47 days overdue — stage 3 of the statutory-style ladder that *code*, not the model, walks daily. The agent's job is the words:

> **Final Notice: Outstanding Levies – Lot 7**
> Dear Pat Latimer, your levy payments for Lot 7 are $1,153.85 overdue (47 days), plus $14.86 penalty interest. This is a final notice; please contact us to arrange payment or discuss a hardship plan…

Those figures are correct to the cent — and they'd be correct even if the model hallucinated, because GoodStrata appends a code-generated statement block to every money email. **The LLM never computes money.** Levy apportionment (largest-remainder, sums exactly), penalty interest (actual/365), payment matching, vote weighting: deterministic engines with exhaustive tests.

### T+9:32 — the maintenance agent triages the leak and hires the roofer

> *"Water stain caused by roof leakage (common property) beneath roofline, worsening with rain; not internal fittings or owner's lot issue."* — category: roofing, urgency: high, **common property: yes**

That's the exact legal distinction (owners corporation vs lot owner responsibility) that fills strata Facebook groups with grief, made correctly by a local model. It then proposed Rapid Roofing with a $350 inspect-and-repair scope. $350 is under the scheme's auto-approve threshold, so **the platform** — never the model — dispatched it immediately and emailed the contractor a bounded work order: *"Approved amount: $350.00 (do not exceed without written approval)."* The model even tried the same tool twice; the state guard rejected the duplicate. One work order exists.

### Day 61 — the machine stops and asks the humans

We fast-forwarded lot 7 to 61 days overdue. The daily sweep crossed the day-60 line, and the finance agent did the one thing it's *not allowed* to do alone — it opened a committee decision:

> **Commence debt recovery — lot in arrears 61 days**
> Lot 7 (Pat Latimer) 61 days overdue with $1,153.85 levies and $19.28 penalty interest. Recommend committee approval to commence recovery.

The agent's run ends there, in a state literally called `awaiting_decision`. A committee member opened the decisions inbox and tapped **Approve** — the single human act in this entire story. A code executor (not the model) then sent the formal demand: total now payable **$1,173.13**, 14 days, hardship option stated.

### The payment closes the loop by itself

Pat paid by the unique payment reference on the notice. The webhook was signature-verified, matched to the notice, posted to the lot ledger, split across the admin and maintenance funds to the cent, receipted, and emailed — status: **paid**. Nobody reconciled anything.

## The scoreboard

| | |
|---|---|
| Events on the audit log | **110** |
| Agent runs | **4** (maintenance, finance ×2, meetings) |
| Total model tokens | **~21,000** |
| Emails drafted & sent | 4 (final notice, work order, formal demand, receipt) |
| Work orders dispatched | 1 ($350, threshold-routed by code) |
| Human decisions required | **1** (approve debt recovery) |
| Money computed by an LLM | **$0.00** |
| Hardware | one MacBook, Qwen3-30B-A3B via Ollama |

Around 21k tokens of local inference ran a month's worth of strata management. At hosted-model prices that's a few cents; on your own machine it's electricity. This is why GoodStrata can be free.

## Why you can trust it (the honest version)

Not "trust the AI" — trust the architecture:

- **Append-only event log**, enforced by a database trigger. Every action carries its actor (user, agent, or system) and a causation chain back to what triggered it. The Agents tab shows every model tool-call.
- **Decision gates.** Budgets, over-threshold works, debt recovery, rule matters — agents can only *propose*, with evidence attached. Approval executes exactly the proposed action, via code.
- **Statute as code.** The 14-day meeting notice rule, entitlement-weighted voting, 75% special resolutions, the s 89 bar on arrears lots voting, the arrears ladder — unit-tested functions, not prompt text.
- **Deterministic money.** If every model on earth were replaced with a random number generator tomorrow, your levies would still sum to the budget exactly.

## Get it

- **Self-host:** `docker compose --profile app up` — Postgres plus one container. Point `AI_PROVIDER=local` at Ollama, or `anthropic` for hosted Claude. Demo building included: `pnpm seed:demo`.
- **Managed:** [goodstrata.com.au](https://goodstrata.com.au) — same open code, hosted, with real NPP/PayID payments. Join the early-access list.
- **Source:** Apache-2.0, on GitHub. The e2e test drives the entire story above — onboarding to AGM — in a real browser on every commit.

Your building's money, minutes, and maintenance — run perfectly, audited completely, and owned by no one but you.

---

*Artifacts from the simulation in this post (agent transcripts, the event log, every email) are in the repo under `docs/blog/sim-artifacts/` — regenerate them yourself with `pnpm seed:demo` and a local model.*

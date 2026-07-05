# GoodStrata privacy pack — data-flow map + APP compliance matrix

> **Prepared as factual/product research for counsel review. Not legal advice.**
> Compiled 5 July 2026 from the code in this repository (`open-goodstrata`). Every claim cites the
> file it was read from. Where a fact cannot be established from code (e.g. the actual Supabase
> region), it is marked **[founder to confirm]**.

Entity: Good Strata Pty Ltd (ABN 55 684 135 760 · ACN 684 135 760), Melbourne VIC.
Hosted service: `my.goodstrata.com.au` (+ `mcp.goodstrata.com.au`, marketing at `goodstrata.com.au`).
The code is open source (Apache-2.0); self-hosted deployments are out of scope of this pack — the
live privacy policy already carves them out (`site/privacy/index.html` §9).

---

## 1. Data-flow map

### 1.1 What personal information the system collects (database schema)

All tables in `packages/db/src/schema/`. PI-bearing fields only.

| Table (file) | PI fields | Notes |
|---|---|---|
| `users` (`auth.ts:8`) | name, email, avatar image URL | better-auth identity. Email unique. |
| `sessions` (`auth.ts:18`) | **IP address, user agent**, session token | Per sign-in. |
| `accounts` (`auth.ts:31`) | hashed password; **Google OAuth access/refresh/ID tokens** (plaintext text columns) | Tokens stored unencrypted at the application layer. |
| `verifications` (`auth.ts:49`) | email verification / reset tokens | Expiring. |
| `people` (`tenancy.ts:112`) | given/family name, company, email, phone, **mailing address (jsonb)**, comms preferences | The strata roll. A person may never log in; entered by committee/manager, not by the individual. |
| `lots`, `ownerships`, `tenancies` (`tenancy.ts`) | lot/unit number, street address, person↔lot ownership & tenancy history with dates | Statutory register content. |
| `memberships` (`tenancy.ts:183`) | user role history per scheme (chair/secretary/treasurer/…) | Period-bounded, history preserved by design. |
| `invites` (`tenancy.ts:207`) | invitee email, role, single-use token | |
| `messages` (`comms.ts:11`) | **full body of every email/SMS in or out**, recipient address, linked person | The correspondence log — a complete copy of all notices, arrears letters, etc. |
| `payments` (`finance.ts:206`) | **payer name**, PayID reference, amount, **raw provider webhook payload (jsonb)** | Raw Monoova payload retained verbatim. |
| `lot_ledger_entries`, `levy_notices` (`finance.ts`) | per-lot arrears/financial position, PayID per notice | Financial information tied to identifiable owners via ownerships. |
| `bank_accounts` (`finance.ts:320`) | per-scheme BSB + account number (OC trust accounts) | Scheme-level, not personal, but sensitive financial data. |
| `complaints`, `breach_notices` (`grievances.ts`) | complainant + respondent identity, **free-text dispute details** | Free text can contain health/hardship/sensitive information with no special handling. |
| `meetings` (`meetings.ts:34`) | video URL, AI-chair log; **meeting transcripts** stored as documents | Transcripts carry speaker names + everything said. |
| `votes`, `proxies`, `meeting_attendance` (`meetings.ts`) | **per-person voting record**, proxy grants, attendance | Statutory record; retained indefinitely. |
| `community_*` (`community.ts`) | posts, comments, likes, uploaded images, keyed to author user | Facebook-group-style board. |
| `documents` (`documents.ts:9`) | uploaded files (any content), uploader actor, s146 access tier, `retentionUntil` | See retention, §1.5. |
| `notifications` (`notifications.ts`) | per-user notification title/body | |
| `event_log` (`spine.ts:35`) | **append-only audit spine**: every domain mutation, payload + actor jsonb | UPDATE/DELETE revoked by migration — cannot be amended. |
| `agent_runs` (`spine.ts:71`) | **the full prompt (`input`) and tool-call transcript (`steps`) of every AI run** | PI that entered a model prompt is persisted here indefinitely. |
| `decisions`, `decision_votes` (`spine.ts`) | committee votes with user id + note | |
| `webhook_events` (`spine.ts:166`) | raw inbound webhook payloads (payer names etc.) | Idempotency ledger; kept indefinitely. |
| `oauth_*`, `jwks` (`mcp.ts`) | OAuth clients/tokens/consents for MCP (claude.ai); **JWKS private keys stored in DB** | |
| `compliance_obligations` (`compliance.ts`) | obligation metadata; completedBy actor | Low PI. |

Collection channels: self-signup (`apps/web/src/routes/signup.tsx`), invite acceptance
(`packages/core/src/services/invites.ts`), bulk entry by committee/manager during onboarding
(`apps/api/src/routes/onboarding.ts` — `POST /:schemeId/people`, `POST /:schemeId/lots/import`),
inbound payment webhooks, Google OAuth profile, Daily.co transcription, file uploads.

### 1.2 Where it is stored

| Store | What | Region (evidence) |
|---|---|---|
| Postgres — **Supabase** | Entire schema above | `deploy/app/worker.ts:6` (Supabase session pooler via `DATABASE_URL`). Region is **not in code**; live privacy policy claims Sydney (`site/privacy/index.html` §4). **[founder to confirm region + Supabase DPA]** |
| Object storage — **S3 or Cloudflare R2** | Documents, meeting transcripts, community images, avatars | Driver: `packages/integrations/src/storage.ts:69`. Prod env defaults `STORAGE_REGION` to `ap-southeast-2` but presence of `STORAGE_ENDPOINT` selects R2 (`deploy/app/worker.ts:81-91`); R2 uses region "auto". **[founder to confirm which is live, bucket region / R2 jurisdiction setting]** |
| Container-local disk | Fallback only when no bucket configured (`worker.ts:91`) | Ephemeral. |

### 1.3 Where it is PROCESSED

- **Cloudflare Containers** run the whole app (API, agents, crons) as a single always-warm
  container (`deploy/app/worker.ts`, `deploy/app/wrangler.jsonc`). **`wrangler.jsonc` contains no
  placement or region pinning** — Cloudflare chooses where the container runs, so in-memory
  processing of all PI is **not guaranteed to occur in Australia**, even though the data stores are
  AU-region. This nuance is not reflected in the privacy policy's "stored in Australia" framing
  (storage vs processing). Counsel question below (APP 8).
- **AI model processing.** Provider selection (`deploy/app/worker.ts:57-66`, resolution in
  `packages/agents/src/models.ts`):
  - `ANTHROPIC_API_KEY` present → **hosted Anthropic API** (US processing), default model key
    `anthropic:claude-sonnet-4-5` (`models.ts:89`). Takes precedence.
  - else `OPENROUTER_API_KEY` → **OpenRouter** (US) routing to `qwen/qwen3-30b-a3b`.
  - else mock (no external calls). A fully local path (Ollama) exists for self-host.
- **What actually reaches model prompts** (read from agent definitions):
  - Finance agent (`packages/agents/src/agents/finance.ts:60-68`): scheme name, lot number,
    **owner name and email address**, arrears stage/amounts. Model drafts prose; figures are
    appended by code, never model-originated.
  - Chair agent (`packages/agents/src/agents/chair.ts:81-107`): agenda, motions, quorum, chair log,
    and the **last 2,000 characters of the live meeting transcript** (speaker names + speech).
  - Meetings/minutes agent (`packages/agents/src/agents/meetings.ts:15`): structured meeting record
    plus up to **8,000 characters of the stored transcript**.
  - Maintenance agent (`packages/agents/src/agents/maintenance.ts`): request title/description
    (resident free text), contractor list. Its RFQ prompt affirmatively instructs **stripping
    names/contact/address to suburb level** for the outbound scope draft — a good de-identification
    precedent to cite.
  - Every run's prompt and tool transcript is persisted in `agent_runs.input/.steps`
    (`spine.ts:82-84`) — so PI sent to a US model is also retained in the AU database indefinitely.
- **MCP / claude.ai**: the platform is an OAuth 2.1 authorization server for MCP clients
  (`apps/api/src/auth.ts:245-255`; trusted origin `https://claude.ai` at `auth.ts:55`). When a user
  connects Claude to their scheme, scheme data flows to Anthropic's client at the **user's**
  initiative, under scopes `mcp:read/write/govern` with per-user consent records
  (`packages/db/src/schema/mcp.ts:48`).

### 1.4 What leaves to third parties

| Third party | Direction / fields | Evidence | Region |
|---|---|---|---|
| **Monoova** (payments, AU) | Out: schemeId, account name `"GoodStrata OC {schemeId}"`, notice numbers, PayID display name. In (webhook): payer name, amount, PayID, destination account, raw payload stored. | `packages/integrations/src/payments.ts:342-395, 414-461`; webhook ledger `apps/api/src/webhooks.ts:52-59` | AU |
| **AWS SES** (email) | Recipient address + full message content (levy notices, arrears letters, invites, auth mail). | `packages/integrations/src/email.ts:66`; region default `ap-southeast-2` (`worker.ts:72`) | ap-southeast-2 |
| **AWS S3 / Cloudflare R2** (files) | All uploaded documents, transcripts, images. | `storage.ts:69`; `worker.ts:81-91` | ap-southeast-2 / R2 [confirm] |
| **Daily.co** (video, US) | Out: room names, **participant display names** in meeting tokens; transcription started/stopped; AI-chair chat messages. In: **meeting transcripts (Deepgram via Daily)** fetched then stored as documents. | `packages/integrations/src/video.ts:134-270` | US |
| **Anthropic / OpenRouter** (AI, US) | Prompt content per §1.3. Anthropic API does not train on API data by default — the policy's "we do not use your PI to train third-party AI models" claim (§3) is consistent, but should be contractually anchored. | `worker.ts:57-66`, `models.ts` | US |
| **Google** (OAuth, US) | In: profile name, email, avatar on "Sign in with Google"; tokens stored in `accounts`. | `apps/api/src/auth.ts:79-96`; `worker.ts:97-103` | US |
| **Twilio** (SMS, US) | Driver exists (`packages/integrations/src/sms.ts:35`) but **no Twilio secrets are wired in the prod worker env** (`worker.ts`) — SMS is not live. Flag for future. | | — |
| **Google Tag Manager** (analytics) | Marketing site only (`goodstrata.com.au`, incl. the privacy page itself) loads GTM `GTM-NQDV7J3M` (`site/privacy/index.html:4-9`). **The privacy policy does not mention analytics or cookies at all.** | | US |
| **claude.ai (MCP client)** | User-initiated; see §1.3. | `auth.ts:55, 245-255` | US |

### 1.5 Retention (what the code actually does)

- `documents.retentionUntil` is set **only** for category `financial`: now + 7 years, citing OC Act
  s 144 (`packages/core/src/services/documents.ts:17,50-55`; column comment
  `packages/db/src/schema/documents.ts:23-24`).
- **Nothing enforces it.** There is no deletion or de-identification job anywhere in the codebase —
  `retentionUntil` is written and displayed (`apps/api/src/routes/onboarding.ts:153,163`) but never
  queried by any sweep. Documents, messages, transcripts, `agent_runs`, `webhook_events`,
  notifications and sessions are all retained indefinitely.
- `event_log` is **append-only by design** (UPDATE/DELETE revoked by migration —
  `spine.ts:31-34`); the privacy policy discloses this (§7).
- **Account deletion**: self-serve, gated by typed email + current password
  (`apps/api/src/auth.ts:178-185`; UI `apps/web/src/components/settings/SecuritySection.tsx:618`).
  `sessions`/`accounts` cascade on user delete (`auth.ts:26,37`), **but** `people.userId`,
  `memberships.userId`, `community_posts.authorUserId`, `decisions.decidedByUserId` and
  `decision_votes.userId` reference `users.id` with **no ON DELETE action** — at the database level
  a user who has joined a scheme or posted/voted appears un-deletable (FK violation) unless
  better-auth or app code unwinds those rows first. **Untested; needs verification** — either a
  bug to fix or, if deletion is meant to be blocked for members (statutory records), the UI and
  policy should say so.
- Avatar files are the only storage objects the code ever deletes (`apps/api/src/routes/profile.ts:96-122`).

---

## 2. APP compliance matrix

Status legend: ✅ largely addressed in code/policy · ⚠️ partial · ❌ gap.

| APP | What the platform does today (evidence) | Gap | Counsel question |
|---|---|---|---|
| **APP 1** — open and transparent management | Privacy policy live at `goodstrata.com.au/privacy` (`site/privacy/index.html`, "last updated July 2026"), linked from every transactional email footer (`packages/core/src/email/layout.ts:49,391,450`) and required at signup. Policy covers collection, AI processing, storage location, third parties, security, retention, access/correction, self-host carve-out, OAIC escalation. Its own fine print says it needs lawyer review (§ closing note). ⚠️ | Policy omits **analytics/cookies (GTM runs on the marketing site)**; no documented privacy-management program or breach-response plan; policy contact is "via goodstrata.com.au or GitHub" — no privacy officer or email address. | Is a GitHub link an acceptable APP 1 contact channel? Minimum internal practices/procedures doc for a two-sided platform (Good Strata vs each OC as the record-keeper)? Controller/processor characterisation: is Good Strata acting for itself, or for each OC — and does the policy need to say which, per function? |
| **APP 2** — anonymity/pseudonymity | Marketing tools (fee estimator) work without login. Everything else requires identity — inherent to a statutory strata roll. ✅/N-A | None material. | Confirm the "impracticable" exception squarely covers roll/ledger/voting functions so no anonymity pathway is required. |
| **APP 3** — collection of solicited PI | Fields collected map tightly to OC administration (§1.1); most PI is collected **from the OC/committee/manager rather than the individual**, which the policy discloses (§2). Free-text fields (complaints `grievances.ts:41-44`, maintenance descriptions) can attract **sensitive information** (health, hardship) with no consent gate or special handling. ⚠️ | No sensitive-information flag/consent flow; hardship payment plans (`finance.ts:350`) inherently involve financial-hardship narratives. | Does complaint/hardship free text trigger APP 3.3 (sensitive info consent) obligations for Good Strata, or does the OC's statutory function carry it? Any data-minimisation edits counsel wants (e.g. warning text on complaint forms)? |
| **APP 4** — unsolicited PI | Inbound webhooks are signature-verified and schema-validated; unattributable payments are parked, not dropped (`webhooks.ts:100-106`). No procedure for destroying unsolicited PI that arrives in free text or misdirected uploads. ⚠️ | No documented APP 4 destroy/de-identify procedure (and no deletion tooling to execute one — §1.5). | Practical APP 4 procedure for a records platform whose audit spine is append-only? |
| **APP 5** — notification of collection | Signup requires ticking acceptance of Terms + Privacy Policy (`apps/web/src/components/auth/sign-up-form.tsx:23,172-186`). Invite emails link the policy in the footer (`email/layout.ts:391`). **But the majority of data subjects — owners/tenants entered onto the roll by a committee member or manager — may never receive anything**: `POST /people` (`onboarding.ts:77`) sends no notice; invites are optional and only possible where an email exists (`invites.ts:36`). ⚠️/❌ | No collection notice at or near the time PI is entered on someone's behalf; no APP 5 matters (purpose, disclosees, cross-border, complaints) presented at signup beyond the policy link. | What are "reasonable steps" here — e.g. an automatic first-contact email/letter when a person with an email/mailing address is added to a roll? Can the OC's own obligations be leaned on contractually (ToS clause obliging the committee to notify)? |
| **APP 6** — use and disclosure | Uses match the collection purposes: levy/arrears administration, meetings, maintenance, comms — all scheme-scoped with role gating (`requireSchemeMember`, `requireRole` in `apps/api/src/middleware.ts` usage across routes, e.g. `trust.ts:10`). AI processing is a disclosed operational use (policy §3) and prompts are purpose-limited (§1.3); the model never originates financial figures (`finance.ts:41-44,94-102`). MCP disclosure to claude.ai is user-initiated with recorded consent (`mcp.ts:48`). ✅/⚠️ | Whether sending owner name/email + arrears state, or meeting transcripts, to a **US model provider** is within the primary purpose or needs the policy to be more specific than "a model provider engaged to process operational data on our behalf" (§3 currently names no provider). | Should the policy name Anthropic/OpenRouter/Daily as processors (the third-party table §5 currently lists only Supabase/Monoova/AWS)? Is "related secondary purpose + reasonable expectation" sound for AI drafting, or is explicit notice needed? |
| **APP 7** — direct marketing | No marketing use of platform PI found in code; transactional email only. GTM on the marketing site is the only ad-tech surface. ✅ | Cookie/analytics disclosure (see APP 1). | None beyond APP 1 fix. |
| **APP 8** — cross-border disclosure | AU-region for the data stores (Supabase Sydney [confirm], SES/S3 ap-southeast-2 — §1.2). **Offshore flows: Anthropic or OpenRouter (US, AI prompts incl. names/emails/transcripts), Daily.co (US, live audio → transcripts), Google (OAuth), Cloudflare (compute placement not region-pinned — `wrangler.jsonc` has no placement config), GTM (US).** Policy §5 says only "some providers may process or store data outside Australia; …reasonable steps". ❌ | No named offshore recipients or countries in the policy; no evidence in-repo of DPAs/contractual APP-equivalence (s 16C accountability); the "Data hosted in Australia" headline elides US *processing*. | Which mechanism per provider: informed consent (APP 8.2(b)) vs contractual reasonable steps + retained accountability? Does Cloudflare container placement constitute "disclosure" at all (transient processing) or should we pin/contract for AU placement? Priority order for signing DPAs (Anthropic, Daily, Cloudflare, Supabase, AWS, Google)? |
| **APP 9** — government identifiers | None collected or adopted; ABN/plan-of-subdivision are entity identifiers (`tenancy.ts:27,68`). ✅ | None. | None. |
| **APP 10** — quality of PI | Email changes are double-confirmed to the old address (`auth.ts:141-177`); votes snapshot entitlement at cast time by design (`meetings.ts:121`); roll data maintained by officers. ✅/⚠️ | No staleness prompts for roll data; person records have no update endpoint at all (see APP 13). | Is officer-maintained roll data enough, given the OC (not the individual) is the statutory record-keeper? |
| **APP 11** — security + destruction | **Security (strong story):** HSTS+preload, X-Frame-Options DENY, Permissions-Policy lockdown, CSP staged report-only (`apps/api/src/security-headers.ts`); role-gated s146 document tiers with a single source of truth (`packages/core/src/services/documents.ts:20-39`); per-scheme storage-key segregation with traversal guards (`storage.ts:19-34`); auth rate limits incl. OAuth endpoints (`auth.ts:186-214`); hashed passwords; signed webhooks failing closed (`payments.ts:326-336,397-412`); SMTP header-injection guard (`email.ts:22-29`); append-only audit spine with actor attribution (`spine.ts:31-62`); per-OC trust-account segregation (`finance.ts:310-318`). **Destruction (weak):** §1.5 — retention recorded, never enforced; no de-identification tooling; agent prompt transcripts and full correspondence bodies retained forever; OAuth tokens and JWKS private keys plaintext in DB (`auth.ts:38-40`, `mcp.ts:59-65`); account deletion likely blocked by FKs. ⚠️/❌ | Destruction/de-identification is the single biggest engineering gap; CSP still report-only; no field-level encryption for the roll. | How to reconcile APP 11.2 destruction with OC Act permanent-record obligations — is "retain under the OC's instruction" the right frame (processor-style), with de-identification only for Good-Strata-purpose data (sessions, logs, agent transcripts)? Minimum retention schedule counsel would defend? |
| **APP 12** — access | Self-serve today: own profile/avatar (`routes/profile.ts`), own lot statements and documents by role tier (`onboarding.ts:171-215`), community content, settings. Policy §8 promises access on request, response "within a reasonable time", mostly free. ⚠️ | **No data-export/takeout endpoint**; no internal tooling to compile "everything we hold about person X" (PI is spread across ~20 tables incl. free text and `agent_runs` transcripts); 30-day APP 12 clock unsupported by process. | Acceptable manual process at current scale? Who answers when the requester is on the roll of an OC whose committee — not Good Strata — entered the data? |
| **APP 13** — correction | Self-serve: name/avatar/email (double-confirmed). **The `people` roll record has no update endpoint at all** — code has create (`onboarding.ts:77`) and invite-link (`invites.ts:118`) only; an owner cannot correct their own phone/mailing address, and neither can the committee through the API. Policy §8 says corrections may be routed "through the owners corporation or its committee". ❌ | Missing person-update capability entirely (product gap, not just privacy); no correction-request workflow or notation mechanism (APP 13.4 statement-association). | If Good Strata refuses/routes a correction, what notation obligations bite the platform vs the OC? |

---

## 3. Notifiable Data Breaches (NDB) readiness

What the audit surface can actually do today:

**Could detect / reconstruct**
- Every **domain mutation** is written to the append-only `event_log` in the same transaction, with
  payload, actor (user/agent/system) and correlation/causation ids (`spine.ts:35-62`). A write-side
  breach (tampering, unauthorised changes) is fully reconstructable and cannot be covered up
  (UPDATE/DELETE revoked).
- Every AI action is replayable: `agent_runs` keeps the exact prompt, tool calls, and outputs
  (`spine.ts:71-101`) — an "agent did something wrong" incident is assessable to the token.
- Inbound webhooks are ledgered with signature validity (`spine.ts:166-178`; `webhooks.ts:52-64`)
  — forged-webhook attempts are visible.
- Sessions record IP + user agent per sign-in (`auth.ts:22-23`), and Cloudflare observability is on
  (`wrangler.jsonc: "observability": {"enabled": true}`).

**Could NOT detect**
- **Reads are not logged.** Document content fetches (`onboarding.ts:187`), roll listings, and lot
  statements leave no audit trace — the event spine records mutations only. Bulk exfiltration by a
  valid-but-compromised account would be invisible except in Cloudflare request logs
  **[founder to confirm log retention there]**.
- **Auth events are not in the audit log**: failed sign-ins, password resets, magic-link issuance,
  and rate-limit trips are not written to `event_log`; the limiter is in-memory only
  (`auth.ts:191-196`) and evaporates on restart.
- No alerting/anomaly detection of any kind; no admin security dashboard.

**Could notify**
- Mechanically strong: the comms service can email every affected person, and every send is logged
  per-person in `messages` (`comms.ts:11-33`) — proof of notification comes free. `people` holds
  email + mailing address for non-login individuals.

**Gaps for counsel/product**
1. No written data-breach response plan (30-day assessment clock, roles, OAIC statement template).
2. Add read-access logging for document content + roll exports (small change: the endpoints are
   already centralised).
3. Persist auth security events (failed logins, resets) to the spine or a security log.
4. Clarify the notification split in the OC context: for a breach of a scheme's records, who
   notifies — Good Strata (holder) or the OC (the entity to whom the records belong)? The ToS
   should allocate this.

---

## 4. Three weakest APP areas (summary for the lead)

1. **APP 8 — cross-border.** US processing (Anthropic/OpenRouter prompts with names, emails and
   meeting transcripts; Daily.co live audio; un-pinned Cloudflare compute) sits under a policy that
   headlines "Data hosted in Australia" and names no offshore recipient. No DPA evidence in-repo.
2. **APP 11 (destruction limb) / deletion integrity.** `retentionUntil` is recorded but nothing
   ever deletes or de-identifies anything; correspondence bodies, transcripts and AI prompt logs
   are retained indefinitely; and self-serve account deletion appears blocked at the database by FK
   constraints once a user has scheme history — untested, needs verification either way.
3. **APP 5 — collection notices for roll-entered individuals.** Most data subjects (owners/tenants
   added by a committee or manager) receive no notice at collection unless someone chooses to send
   an invite; the signup checkbox only covers the minority who self-register. Closely followed by
   **APP 13**: there is no endpoint to correct a person's roll record at all.

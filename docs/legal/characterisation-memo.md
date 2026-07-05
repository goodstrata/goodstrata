# Characterisation Factual Memo — is hosted GoodStrata an "owners corporation manager"?

> **Prepared as factual/product research for counsel review. Not legal advice.**

Prepared 2026-07-05 for Good Strata Pty Ltd (ACN 684 135 760 · ABN 55 684 135 760).
Companion to `docs/LEGAL-BRIEF.md` (question A.1), `docs/COMPLIANCE-GAPS.md`, and
`docs/REGISTERED-MANAGER-READINESS.md`.

**Method.** Every statutory quotation below was retrieved verbatim from AustLII
(Victorian Current Acts consolidation of the Owners Corporations Act 2006, "the Act")
on 2026-07-05. Every product fact was read from the codebase at the current `main`
(HEAD c55b28b) and is cited to file and line. Where a fact cuts *against* the tool
characterisation it is recorded anyway — counsel should not receive a curated matrix.

**The question for counsel.** When an owners corporation (OC) self-manages using the
hosted GoodStrata platform — software plus AI agents operated by Good Strata Pty Ltd —
is Good Strata Pty Ltd (a) the OC's "manager" for the purposes of Part 6 (s 119
appointment, s 122 duties) and Part 12 (s 178 registration offence) of the Act, or
(b) a tool with which the OC and its human officers manage themselves?

---

## 1. Statutory framework (verified verbatim)

### 1.1 There is no general definition of "manager"

Section 3 of the Act defines many terms but **does not define "manager"**. The only
related definitions are:

> **"registered manager"** means a manager registered under Part 6;
>
> **"function"** includes duty and authority;

— OC Act 2006 (Vic) s 3 (AustLII Victorian Current Acts, retrieved 2026-07-05).

**Discrepancy to verify.** The AustLII consolidation's s 3 definition reads "registered
under **Part 6**", but the Act's table of provisions places s 119 in *Part 6 — Managers*
and the registration regime (ss 178–199, including the s 178 offence) in *Part 12 —
Registration of Managers*. Counsel should check the authorised consolidation at
legislation.vic.gov.au; the substantive position (registration under Part 12) is not in
doubt, but a pleading-grade citation should not rest on the AustLII rendering.

Because "manager" is undefined, characterisation appears to turn on the three operative
concepts the Act does use: **appointment** by the OC (s 119), carrying out a **function
as the manager** (s 178; "function" includes duty and authority, s 3), and doing so
**for fee or reward** (ss 119(2), 119(5), 178).

### 1.2 Section 119 — Appointment and removal of manager (Part 6)

> (1) A tier one owners corporation must appoint a person to be the manager of the
> owners corporation.
>
> (1A) Despite subsection (1), a tier one owners corporation, by special resolution,
> may opt out of the requirement under subsection (1) to appoint a person to be the
> manager of the owners corporation.
>
> (1B) A decision referred to in subsection (1A) may be reversed and a person may be
> appointed to be the manager of the owners corporation by ordinary resolution at a
> date later than the date of the special resolution.
>
> (1C) A tier two owners corporation, a tier three owners corporation, a tier four
> owners corporation or a tier five owners corporation may appoint a person to be the
> manager of the owners corporation.
>
> (1D) A person must not be appointed as the manager of an owners corporation for a
> period that exceeds 3 years.
>
> (2) If the manager is to receive a fee or reward for carrying out the functions of
> manager, a person is not eligible to be appointed unless the person is a registered
> manager.
>
> (3) An instrument or contract of appointment must be in the approved form.
>
> (4) A manager need not be a lot owner.
>
> (5) A person must not be appointed as a manager for fee or reward unless the person
> holds professional indemnity insurance that is sufficient to meet claims up to a
> level of the prescribed amount in any one year.
>
> (6) An owners corporation may revoke the appointment of a manager.

— OC Act s 119 (as amended by No 4/2021 s 51; retrieved 2026-07-05).

Observations of fact: the section is drafted around a **consensual appointment by the
OC** of "a person", evidenced by an instrument or contract in the approved form. Tier
two–five OCs *may* appoint; a tier one OC *must* unless it opts out by special
resolution. Nothing in s 119 defines what makes a person a manager absent appointment.

### 1.3 Section 178 — Offence to act as manager without being registered (Part 12)

> A person must not, alone or in partnership, carry out any function as the manager of
> an owners corporation for fee or reward unless the person is registered under this
> Part.
>
> Penalty: 60 penalty units.

— OC Act s 178 (retrieved 2026-07-05).

This is the provision that can bite **without** any appointment: it attaches to
*carrying out any function as the manager* + *for fee or reward*. Both limbs are
questions of fact addressed in §§3–4 below.

### 1.4 Section 122 — Duties of manager (extracts)

> (1) A manager — (a) must act honestly and in good faith … (b) must exercise due care
> and diligence … (d) must take reasonable steps to ensure that any goods or services
> procured by the manager on behalf of the owners corporation are procured at
> competitive prices and on competitive terms; and (e) must not exert pressure on any
> member … to influence the outcome of a vote … (f) [commission disclosure per s 122B]
>
> (2) A manager — (a) holds all money held on behalf of an owners corporation on trust
> for the owners corporation; … (c) subject to subsection (3), must hold all money held
> on behalf of separate owners corporations on trust in separate bank accounts; …
>
> (4) Money held by a manager on behalf of an owners corporation on trust for the
> owners corporation includes any interest earned.

— OC Act s 122 (retrieved 2026-07-05; full text in `docs/REGISTERED-MANAGER-READINESS.md` §5).

s 122 only *applies* to a person who is a manager; but its subject matter (procurement,
money-holding, vote influence) is a useful checklist of what the legislature regards as
manager functions, and §4 maps the platform's capabilities against it.

### 1.5 Chairing provisions — ss 79 and 98

> **s 79 — Who chairs the general meeting?**
> (1) The lot owners present at a general meeting may elect one of their number or the
> manager of the owners corporation to chair the meeting.
> (2) If the chairperson of the owners corporation is present at a general meeting and
> an election under subsection (1) has not been made, the chairperson chairs the
> meeting.

> **s 98 — Chairperson of owners corporation**
> (1) If an owners corporation does not have a committee, the lot owners must elect a
> member to be the chairperson of the owners corporation.
> (2) If an owners corporation has a committee, the chairperson of the committee is
> also the chairperson of the owners corporation.
> (3) A chairperson elected by the lot owners … may be removed by resolution at a
> general meeting.

— OC Act ss 79, 98 (retrieved 2026-07-05).

**Factual significance:** the class of permitted general-meeting chairs is closed —
*a lot owner present, or the manager of the owners corporation* (or, by default, the
s 98 chairperson). If the product's "AI chair" were characterised as the person actually
chairing the meeting, the only s 79 slot it could occupy is "the manager of the owners
corporation" — i.e. the AI-chair branding itself pulls toward the manager
characterisation. This drives §5.

---

## 2. Platform facts common to every capability

These architectural facts recur throughout the matrix and are established once here.

1. **Attribution.** Every event in the append-only event log is stamped with an actor:
   `user` (a human account), `agent` (a named AI agent + run id), or `system` (a named
   cron/worker) — `packages/shared/src/actor.ts:5-23`. Human and automated acts are
   distinguishable record-by-record.

2. **Decision gates.** The decisions service opens "human decision gates"; only a
   signed-in **user** may resolve one (`packages/core/src/services/decisions.ts:295-297`),
   voting rules route by role (treasurer / committee majority / all owners,
   `decisions.ts:91-110, 187-252`), and the approved follow-up is executed by
   deterministic code, "never an LLM" (`decisions.ts:332-373`).

3. **Roles.** All in-app authority flows from scheme memberships held by humans:
   owner, committee_member, chair, secretary, treasurer, tenant, contractor, and
   `manager_admin` (`packages/shared/src/enums.ts:27-37`). `manager_admin` is the
   super-role that bypasses role gates; it is granted to **the user who creates the
   scheme** (self-service; `packages/core/src/services/schemes.ts:24,67`), is not
   invitable (`enums.ts:40-56`), and is not held by Good Strata staff over customer
   schemes. NB the role's *name* ("manager_admin") and the back-office route comment
   "this is manager back-office" (`apps/api/src/routes/manager.ts:19`) are labelling
   facts counsel may want changed (§6).

4. **Two delivery modes.** Self-hosted (Apache-2.0, runs on the OC's own
   infrastructure; Good Strata provides nothing at runtime) and hosted
   (my.goodstrata.com.au, operated by Good Strata Pty Ltd). Only the hosted mode raises
   the characterisation question; ToS cl 7 expressly carves self-hosting out
   (`site/terms/index.html`).

5. **Remuneration — the honest position.** The software is free for OCs: no per-lot
   fee, no subscription (ToS cl 3; `site/how-we-make-money/index.html`). **However**,
   the published business model is *not* "no revenue": the site and ToS disclose
   (a) "a small, published margin" on payments that move through the platform (levies
   in, contractor payments out), (b) a **paid managed-service tier**, and (c) "a small
   platform component on statutory certificates". As at 2026-07-05 none of these is
   implemented in code — there is no margin arithmetic anywhere in the payments path
   (`packages/integrations/src/payments.ts`, `packages/core/src/services/payments.ts`)
   and payments are sandbox-only (`docs/LEGAL-BRIEF.md` line 21) — but the *stated
   intention* to earn on money movement exists in public marketing today. Whether that
   margin is "fee or reward **for carrying out the functions of manager**" (s 178) or
   consideration for a payments/software service is a central question for counsel.
   The claim "Good Strata is not remunerated" is only accurate today in the narrow
   sense that no live revenue exists yet.

---

## 3. Factual matrix by capability

Format per row: what the platform does · who initiates · who approves · attribution ·
remuneration nexus.

### 3.1 Levy calculation and levy notices

- **What:** apportionment by lot liability via a deterministic engine
  (`calculateLevyRun`, `packages/core/src/engines/levy-calc.ts`, invoked at
  `packages/core/src/services/levies.ts:114-118`); notices numbered, charged to the lot
  ledger, and **emailed to owners from platform infrastructure** with statutory
  wording ("Payment is due at least 28 days after this notice under the Owners
  Corporations Act 2006 (Vic)", `levies.ts:283`).
- **Who initiates:** a human officer. The issue-run endpoint is gated to
  chair/secretary/treasurer (or the scheme's own manager_admin)
  (`apps/api/src/routes/finance.ts:18,64-68`). There is **no cron that issues levies**.
- **Who approves:** the budget behind a levy schedule must first be adopted through a
  treasurer decision gate (`apps/api/src/mcp/tools/writes.ts:219` describes the flow;
  `levies.ts:55,103` validates adoption).
- **Attribution:** the initiating user's actor on every event.
- **AI involvement:** none. No LLM touches amounts anywhere ("the money is code, not
  the AI", ToS cl 4; enforced structurally — agents have no levy tools).

### 3.2 Arrears chasing

- **What:** a daily sweep computes arrears stages in pure code (cron "never calls an
  LLM", `packages/core/src/services/arrears.ts:94-97`) and emits
  `arrears.stage.reached` events. The **finance agent** then reacts:
  - Stages 1–3: it drafts **and sends** reminder/final-notice emails to the owner
    **autonomously — no human approves the send**
    (`packages/agents/src/agents/finance.ts:33-38, 75-117`). Figures are appended by
    code, the model writes only prose (`finance.ts:41-43, 94-102`).
  - Stage 4 (day-60 debt recovery): the agent must NOT email; it opens a committee
    decision gate, and only committee approval triggers
    `finance.commenceDebtRecovery` executed by code (`finance.ts:119-156`).
- **Who initiates:** the system (cron) + agent, not a human.
- **Who approves:** nobody, for stages 1–3; the committee, for recovery.
- **Attribution:** system actor for the sweep, agent actor for the emails, user actors
  for the recovery decision.
- **Candour note:** *automated correspondence chasing owners for money, initiated and
  dispatched by the operator's agents without a human in the loop, is the single
  strongest "functions of a manager are being carried out by the platform" fact in the
  codebase.*

### 3.3 Meeting convening, notice and conduct (the AI chair)

- **Convening/notice:** meetings are created and statutory notices sent by human
  officers via role-gated routes (`apps/api/src/routes/meetings.ts:17`); the 14-day
  notice floor is enforced in code (`packages/core/src/services/meetings.ts:30,102-111`).
  The notice email is sent by the platform in the OC's name ("notice is given of the
  following meeting of {scheme}", `meetings.ts:166`).
- **Starting conduct:** a human officer (chair/secretary/treasurer or manager_admin)
  must start the video meeting (`routes/meetings.ts:105-123`). That event kicks off a
  code-owned conductor loop: a tick every 60 seconds, hard-capped at 60 ticks
  (`apps/api/src/boot.ts:32-34,146-190`; `meetings.ts:354,367-398`).
- **What the AI chair does per tick** (`packages/agents/src/agents/chair.ts`):
  reads agenda/motions/quorum/transcript tail; may (a) post guidance to the room chat
  as **"GoodStrata Chair"** (`meetings.ts:343`), (b) **open voting on draft motions**,
  (c) **close voting and tally** (deterministic engine does the arithmetic), (d) record
  action items. Its instructions require neutrality ("never take sides on a motion",
  `chair.ts:42`). Max 2 tools per tick, max 4 steps per run.
- **What the AI chair cannot do:** cast or alter votes (only owners/proxies with
  standing may vote, with s 94 arrears exclusion enforced at cast time,
  `meetings.ts:532-599`); create motions; close the meeting; adjourn; rule on points of
  order; decide quorum (computed by code, `meetings.ts:794-835`).
- **Who approves:** motion outcomes are decided solely by member votes tallied by the
  engine (one-vote-per-lot for ordinary resolutions, entitlement on a demanded poll,
  `meetings.ts:442-495,639-704`).
- **Candour notes:** (i) opening and closing a motion is a *procedural power of the
  chair* under ordinary meeting practice, and the agent exercises it in its own name;
  (ii) the product brands the agent "chair"/"GoodStrata Chair" in the room and the UI;
  (iii) **no field in the data model records a human chairperson of the meeting**
  (§5.1).

### 3.4 Minutes

- **What:** on `meeting.closed`, the meetings agent drafts minutes from the structured
  record (motion texts, exact tallies it must copy, quorum) plus the transcript, and
  stores them as a document titled "Draft minutes"
  (`packages/agents/src/agents/meetings.ts:24-153`).
- **Candour note:** the agent then **flips the meeting status to
  `minutes_distributed` itself** (`agents/meetings.ts:133`) — there is currently no
  human sign-off gate between AI draft and "distributed" status, despite the document
  title saying "Draft". This is a product-fix candidate independent of counsel's view
  (§6, option W6).
- **Transcription:** live transcription runs during the video meeting and the
  transcript is stored as a committee-tier document at close
  (`meetings.ts:225-240, 849-872`).

### 3.5 Complaint / grievance handling and breach notices

- **What:** approved-form complaint intake, 28-day statutory clocks, a state machine
  (received → discussion → notice to rectify → final notice → VCAT), breach notices,
  full audit trail (`packages/core/src/services/grievances.ts:1-100`).
- **Who initiates/approves:** complaints are filed by members self-service; every
  advance of the state machine and every breach notice is made by a **human officer**
  through role-gated routes (`apps/api/src/routes/grievances.ts:15,50-77`).
- **AI involvement:** none. No agent subscribes to complaint events (the agent roster
  is chair, echo, finance, maintenance, meetings — `packages/agents/src/agents/`).
  The "AI-drafted statutory notices" concern in `docs/LEGAL-BRIEF.md` Q12 relates to
  templates, not to any autonomous drafting in code today.

### 3.6 Document custody

- **What:** the OC's records (minutes, transcripts, financial records, certificates)
  are stored in platform-controlled object storage under a per-scheme key
  (`packages/core/src/services/documents.ts:44-48`), with role-tiered access mirroring
  s 146 (`documents.ts:20-40`) and a 7-year retention stamp for financial records per
  s 144 (`documents.ts:18,50-56`).
- **Candour note:** in hosted mode Good Strata Pty Ltd is the *physical* custodian of
  the OC's statutory records. The register/records are the OC's, kept on its behalf;
  whether "keeping the records" is a manager function or ordinary SaaS hosting is one
  of the characterisation sub-questions.

### 3.7 Payments — who holds the money

- **Design:** each scheme gets its **own segregated virtual collection account**
  (Monoova mAccount) with its own BSB + account number; every levy PayID is registered
  under that scheme's account, never a shared pool
  (`packages/integrations/src/payments.ts:42-51,66-75,183-203,342-372`;
  `packages/core/src/services/trustAccounts.ts:1-18`). Levy issuance refuses to
  allocate PayIDs until the scheme's own account exists (`levies.ts:121-129`).
- **The remaining structural fact:** the per-OC virtual accounts hang off **Good
  Strata's master Monoova relationship** (`payments.ts:188-190,209-210` — "the
  master/funding account the virtual accounts hang off"). Good Strata Pty Ltd, not the
  OC, is Monoova's customer. Who "holds" the money for s 122(2) purposes — Monoova (the
  ADI-adjacent licensee), Good Strata, or the OC — is exactly LEGAL-BRIEF question B.4.
- **Inbound only:** there is **no outbound payment / disbursement capability in the
  codebase** as at 2026-07-05 (no disburse/withdraw/pay-out code path exists), despite
  the marketing site describing a margin on "contractor payments out". Money can enter
  a scheme's collection account; the platform cannot move it out.
- **Live status:** payments are sandbox-only; no real money moves today
  (`docs/LEGAL-BRIEF.md` line 21).
- **Attribution:** payment reconciliation is code; the manual rail (recording a bank
  transfer) is treasurer-gated (`routes/finance.ts:91-96`).

### 3.8 Maintenance and procurement

- **What/who:** the maintenance agent triages requests and *proposes* a work order;
  **code, not the model, routes the proposal** by scheme-configured thresholds
  (`packages/core/src/services/maintenance.ts:244-264`):
  - ≤ auto-approve threshold → **auto-dispatched** to the contractor (email sent by the
    platform) with no per-job human approval (`maintenance.ts:331-332`);
  - emergency → dispatched immediately + a **post-hoc committee review** decision
    (`maintenance.ts:335-356`);
  - over threshold → committee decision gate *before* dispatch
    (`maintenance.ts:359-380`).
- **RFQs:** the agent drafts the anonymised scope of works only; officers dispatch the
  RFQ; awards run only through a committee decision
  (`packages/agents/src/agents/maintenance.ts:24-35`).
- **Candour notes:** (i) below-threshold auto-dispatch means the platform *procures
  services on the OC's behalf* without a per-transaction human decision — squarely the
  s 122(1)(d) subject matter — although the threshold itself is set by the OC;
  (ii) the marketing site's no-kickback claims ("the margin is identical no matter
  which contractor") are supported by the absence of any margin/ranking code, and the
  RFQ layer is anonymised by construction (`packages/integrations/src/tradeMarket.ts:13`).

### 3.9 What always requires a human

Compiled from the decision-gate call sites: budget adoption (treasurer), debt-recovery
commencement (committee), over-threshold work orders (committee), emergency-works
review (committee, post hoc), RFQ awards (committee). Resolving any gate requires a
signed-in user with the right role; agents can only *open* gates
(`decisions.ts:295-297`; `finance.ts:153` sets `awaitingDecision`).

### 3.10 Built-in support for appointing a *real* registered manager

The platform also models the conventional arrangement: an organisation-level BLA
registration number and PI-policy capture with compliance-calendar reminders
(`packages/core/src/services/managerRegistration.ts`), and the `manager_admin`
role for an appointed manager's staff. Factually, GoodStrata is built to serve **both**
self-managing OCs and OCs that appoint a (human/corporate) registered manager who uses
the software — a fact that supports the "tool" framing (tools are used by managers;
managers are not made of tools).

---

## 4. The two characterisations, honestly stated

### 4.1 Facts supporting the TOOL characterisation

1. **No appointment.** No OC appoints Good Strata under s 119; there is no instrument
   or contract of appointment in the approved form; the ToS is a software licence /
   hosted-service agreement. s 119's whole scheme (appointment, 3-year cap, approved
   form, revocation) presupposes a consensual appointment that never occurs.
2. **Initiation and authority sit with the OC's humans.** Levy runs, meeting creation,
   notices, video start, complaint advances, breach notices, RFQ dispatch — all are
   triggered by the OC's own officers through role-gated routes (§§3.1, 3.3, 3.5).
   The `manager_admin` super-role belongs to the OC's own founding user, not to Good
   Strata (§2.3).
3. **Decisions are reserved to humans by architecture, not policy.** Spending,
   recovery, awards and budget adoption run through decision gates only users can
   resolve; the follow-up is executed by code (§2.2, §3.9). This is also a term of use
   (ToS cl 4: "Agents execute; humans decide").
4. **The money is deterministic code**; the AI never originates a figure (§3.1, §3.2).
5. **Votes and resolutions are the members' own acts**: standing checks, proxy
   validity, s 94 exclusion, poll demands, and quorum are enforced/computed in code;
   the AI cannot vote or decide an outcome (§3.3).
6. **Attribution is preserved.** Every act is logged to a user, a named agent run, or
   a named system job — the platform can show, record by record, that legal acts
   (resolutions, notices authorised by officers) are the OC's (§2.1).
7. **Self-hosting parity.** The identical software can be run by the OC itself for $0;
   what the hosted tier adds is infrastructure operation, which is ordinary SaaS
   (§2.4). A word processor does not become the company secretary when it is rented
   rather than bought.
8. **No fee from the OC for the software**; no per-lot fee or subscription (§2.5).
9. **The platform equally serves appointed managers** (§3.10), which is the natural
   posture of a tool.

### 4.2 Facts supporting the MANAGER characterisation

1. **"For fee or reward" is arguable on the published model.** s 178 does not require
   appointment — only carrying out *any function as the manager* for fee or reward.
   Good Strata publicly intends to earn a margin on levy collection and contractor
   payments, a paid managed tier, and a certificate fee component (§2.5). A margin
   earned *on the doing of levy collection* is more closely connected to the function
   than, say, a flat hosting fee would be.
2. **Autonomous arrears correspondence.** The operator's agent drafts and sends
   demands for payment to lot owners with no human approval at stages 1–3 (§3.2).
   Levy recovery correspondence is core manager work; here the *platform*, not an
   officer, performs it.
3. **The AI chair exercises chairing powers in its own name.** It opens and closes
   motions and directs proceedings, is branded "GoodStrata Chair", and s 79 permits
   only a lot owner or *the manager* to chair a general meeting (§1.5, §3.3). If the
   agent is "the chair", the statute offers only one non-lot-owner box to put it in.
4. **Minutes are produced and marked distributed by the operator's agent** without
   human adoption (§3.4). Preparing minutes is a classic secretary/manager function.
5. **Below-threshold procurement is executed without per-job human approval** (§3.8) —
   procurement "on behalf of the owners corporation" is s 122(1)(d) language.
6. **Custody of records and of the money rails.** Good Strata hosts the statutory
   records (§3.6) and is the counterparty to the payments provider through which the
   OC's trust-destined money flows (§3.7). The s 122(2) trust architecture in the code
   is designed *as if* a manager's duties applied — which counsel may read either as
   prudent engineering or as an admission of the role's substance.
7. **Product language.** "Manager back-office", `manager_admin`, "GoodStrata Chair",
   "the building runs itself" — the platform's own vocabulary repeatedly claims the
   manager's seat (§2.3, §3.3; `docs/LEGAL-BRIEF.md` Q10).

### 4.3 The pivot facts

The two lists share a spine. Counsel's opinion will likely turn on three questions of
mixed fact and law, so these are the facts to keep stable while the opinion is written:

- **Remuneration nexus:** is a disclosed payment-processing margin (not yet live)
  "fee or reward for carrying out the functions of manager", when the software itself
  is free? The certificate fee component and managed tier need the same analysis.
- **Agency vs instrumentality:** when the finance agent emails an owner, is that Good
  Strata acting (its agent, its infrastructure, its name on the From line?) or the OC
  acting through configured automation it adopted by accepting the ToS and setting the
  ladder? The attribution log (§2.1) supports either telling; the *authorisation
  chain* (OC officers turned it on; OC can turn it off) is the tool-side fact.
- **The chair label:** whether the AI "chairs" (manager-side) or "assists the human
  chair" (tool-side) is currently ambiguous in the product because no human chair of
  record is captured (§5).

---

## 5. The human chair of record

### 5.1 What the code records today

- A **committee office of "chair"** exists and is assignable to a human
  (`packages/shared/src/enums.ts:27-37`; `packages/core/src/services/committee.ts:8-12`)
  — this maps to the s 98 chairperson.
- The **meetings table has no chairperson field**. The only chair-related meeting data
  is `chairLog` — the AI's own notes (`packages/db/src/schema/meetings.ts:51`).
- Attendance records who attended and how, but not who presided
  (`meetings.ts:768-791`).
- Minutes are drafted by the agent from a record that contains no human chair; nothing
  prompts the meeting to elect a chair under s 79(1), and no minute records that the
  s 98 chairperson presided under s 79(2).
- A human officer must start the meeting's video/conduct loop (§3.3), so a human is
  necessarily *present and acting* at the start — but the record does not name them
  as chairing.

### 5.2 Candidate operating models for counsel to choose between

**Model A — Human chair of record; AI assists (the LEGAL-BRIEF working hypothesis).**
The s 98 chairperson (or a s 79(1)-elected lot owner) chairs every general meeting;
the agent is renamed and repositioned as a *meeting assistant/secretary aid* that
proposes, prompts and records, with procedural acts (open/close motion) either
(a) requiring one-click confirmation by the chair of record, or (b) recorded as taken
"by direction of the chair".
*Factual support needed:* a `chairPersonId` (or similar) on the meeting; a UI step at
meeting start electing/confirming the chair; minutes template reciting "The meeting was
chaired by [name] (s 79)"; rebranding of "GoodStrata Chair" chat identity; optionally a
confirm-gate on `openMotion`/`closeMotionAndTally`. All are modest changes — the
conductor loop, tick cadence and tools stay.

**Model B — AI conducts under delegated authority of the chair.**
The human chair of record formally delegates the procedural running of the meeting to
the platform for that meeting (a recorded, revocable delegation at video start), and
remains present and able to override. The agent's acts are minuted as acts of the chair
done through the platform.
*Factual support needed:* everything in Model A **plus** a recorded delegation act
(who, when, scope), an always-available override/stop control for the chair (the
meeting-status flip already stops the loop, `meetings.ts:378-383`, but it is not
surfaced as a chair control), and counsel's view on whether chairing under s 79 is
delegable at all — the statute's closed class (lot owner / manager) is the obstacle,
which is why this model needs the opinion before the build.

**Model C — The platform *is* the meeting chair (manager posture).**
Lot owners elect "the manager" to chair under s 79(1); Good Strata registers under
Part 12, holds $2M PI, is appointed under s 119 in the approved form, and the AI chair
conducts openly as the manager's instrument. This is the only model in which the
current "GoodStrata Chair" branding is statutorily coherent *as chairing*.
*Factual support needed:* the entire §2–§4 readiness map in
`docs/REGISTERED-MANAGER-READINESS.md` (registration, PI, per-OC trust accounts,
approved-form appointments capped at 3 years) — i.e. this model abandons the tool
characterisation for meetings and prices in the full manager regime.

A note on scope: the conduct loop currently runs for **committee meetings and AGMs**
alike (`meetings.ts:213-219`). ss 79/98 govern general meetings; committee-meeting
chairing (s 105) is looser. Counsel may advise different postures for the two meeting
kinds, which the code can distinguish (the meeting `kind` field already exists).

---

## 6. ToS / UI wording changes that would strengthen the tool characterisation

Options for counsel to accept, reject or redraft — none is adopted policy, and several
have product-behaviour prerequisites noted in brackets.

**Terms of Service**

- **W1 — Express non-appointment clause.** "Good Strata Pty Ltd is not, and must not be
  appointed as, the manager of your owners corporation within the meaning of Part 6 of
  the Owners Corporations Act 2006 (Vic). GoodStrata is software with which your owners
  corporation manages itself; the functions of manager, where they are performed at
  all, are performed by your owners corporation, its committee and its officers."
  (ToS cl 1/cl 4 currently *imply* this — "GoodStrata is a tool to help you administer
  your owners corporation" — but never say it.)
- **W2 — Agency disclaimer + authorisation recital.** "Automated agents act only as
  configured and authorised by your owners corporation's officers, as your owners
  corporation's own instrumentality. Good Strata does not itself perform, and is not
  engaged to perform, any function as manager." Pair with an explicit in-product
  record of *which officer* enabled each automation (the arrears ladder, the meeting
  conductor) — [requires: storing the enabling officer; the settings exist but the
  enabling actor is only in the event log].
- **W3 — Fee characterisation clause.** State expressly what each revenue line is
  consideration *for*: the processing margin as consideration for payment-facilitation
  services supplied by the licensed provider arrangement, the managed tier as hosting/
  support, the certificate component as document-platform usage — and that no fee is
  payable to Good Strata *for the performance of any function of manager*. (Counsel to
  confirm this drafting can do the work intended; it cannot survive contradiction by
  conduct.)
- **W4 — Chair-of-record term.** "Meetings conducted on the platform are chaired by
  the person recorded as chairperson for that meeting. Meeting-assistant output is
  advisory and procedural acts are taken under the authority of the chairperson."
  [Requires Model A/B product changes in §5.2 first — do not ship the words before the
  behaviour.]

**UI / product surface**

- **W5 — Rename the agent.** "GoodStrata Chair" → "Meeting Assistant" (chat display
  name at `meetings.ts:343`, UI labels, marketing). The current name is the single
  cheapest fact to fix in §4.2(3).
- **W6 — Human adoption gate for minutes.** Keep the AI draft, but require a
  secretary/chair click to move `closed → minutes_distributed`
  (`agents/meetings.ts:133` currently self-serves this). Label pre-adoption output
  "Draft — not yet adopted".
- **W7 — Chair election step at meeting start** (Model A): capture and display the
  s 79 chair of record; recite them in the notice and minutes.
- **W8 — Rename `manager_admin`** (display label at minimum) to something like
  "scheme administrator", and re-title the "manager back-office" routes — the code
  names are discoverable in an open-source repo and read as admissions
  (`apps/api/src/routes/manager.ts:19`).
- **W9 — Arrears sends: offer a review mode.** An OC-level setting: "arrears reminders
  are sent automatically" vs "held for officer approval". Even if default-automatic,
  the existence of the officer-approval mode (and the OC's recorded choice) converts
  §4.2(2) from "the operator chases owners" into "the OC configured its own chasing".
  [Product change; the decision-gate machinery to build it already exists.]
- **W10 — Marketing accuracy sweep** (overlaps LEGAL-BRIEF Q10): "The building runs
  itself" and the certificate description "Section 32 certificate" (the OC certificate
  is s 151 OC Act; it is *attached to* a s 32 Sale of Land Act statement) should be on
  counsel's ACL review list; both also colour characterisation.

---

## 7. Open items and verification list

1. s 3 "registered manager … Part 6" vs Part 12 rendering — verify against the
   authorised consolidation (§1.1).
2. Whether an AI agent can be "present" / "chair" at all, and whether s 79's closed
   class is mandatory or facilitative — pure question of law for counsel (§5).
3. The remuneration-nexus question on the margin / managed tier / certificate
   component (§2.5, §4.3) — decide *before* the Monoova driver goes live (task #22)
   and before any margin is switched on, because going live converts §4.2(1) from
   intention to conduct.
4. Trust-money holding (LEGAL-BRIEF B.4) interacts with characterisation: if Good
   Strata is found to "hold" OC money, s 122(2) duties presuppose manager status.
5. This memo describes `main` at c55b28b on 2026-07-05; the product changes flagged in
   §6 (W5–W9) will change the factual matrix and should be re-stated to counsel if
   made before the opinion issues.

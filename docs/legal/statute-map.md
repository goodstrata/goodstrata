# GoodStrata — Statute-to-Code Map (Owners Corporations Act 2006 (Vic))

> **Snapshot note:** the code assessment below was prepared on 5 July 2026.
> The implemented remediation and residual counsel questions as at 13 July are
> recorded in
> [`../COMPLIANCE-IMPLEMENTATION-2026-07-13.md`](../COMPLIANCE-IMPLEMENTATION-2026-07-13.md).

> **Prepared as factual/product research for counsel review. Not legal advice.**

Prepared 5 July 2026 for Australian counsel reviewing the go-live of GoodStrata
(Good Strata Pty Ltd, ABN 55 684 135 760), a Victorian owners-corporation
self-management platform. This document (a) verifies the primary-source text of
the provisions the go-live turns on against the current authorised
consolidations, and (b) maps each provision to what the codebase actually does,
with pinpoint file/line references. Quotations are short operative excerpts;
the authorised consolidation prevails over any transcription here.

---

## 1. Sources verified (all retrieved 5 July 2026)

| Source | Version verified | URL |
|---|---|---|
| **Owners Corporations Act 2006 (Vic)** (No. 69/2006) — "the Act" | Authorised consolidation **Version 023** (in force; published Nov 2025; incorporates amendments up to and including Acts No. 40/2024 and 46/2025 per margin notes) | Landing: <https://www.legislation.vic.gov.au/in-force/acts/owners-corporations-act-2006> (resolves to `/023`) · Authorised PDF: <https://content.legislation.vic.gov.au/sites/default/files/2025-11/06-69aa023-authorised.pdf> · DOCX: <https://content.legislation.vic.gov.au/sites/default/files/2025-11/06-69a023.docx> |
| **Owners Corporations Regulations 2018 (Vic)** (S.R. No. 154/2018) — "the Regulations" | **Version 002** (in force; "incorporating amendments as at 1 December 2021", i.e. incl. S.R. No. 147/2021) | Landing: <https://www.legislation.vic.gov.au/in-force/statutory-rules/owners-corporations-regulations-2018> (resolves to `/002`) · DOCX: <https://content.legislation.vic.gov.au/sites/default/files/2021-12/18-154sr002_1.DOCX> |
| AustLII cross-check (ss 119, 122 only) | Victorian Current Acts | <https://classic.austlii.edu.au/au/legis/vic/consol_act/oca2006260/s119.html>, <https://classic.austlii.edu.au/au/legis/vic/consol_act/oca2006260/s122.html> |

Method: the official DOCX consolidations were downloaded from
`content.legislation.vic.gov.au` and converted to plain text locally; all
quotations below were extracted from those files and, where flagged, spot-checked
against the authorised PDF. AustLII text (ss 119, 122) matched the authorised
consolidation verbatim. Nothing below is quoted from a secondary source.

**Codebase reviewed** (repo `open-goodstrata`, working tree as at 5 July 2026):
`packages/core/src/engines/voting.ts`, `packages/core/src/services/meetings.ts`,
`grievances.ts`, `compliance.ts`, `managerRegistration.ts`, `trustAccounts.ts`,
and `packages/integrations/src/payments.ts` (Monoova driver).

---

## 2. Threshold finding — the code cites provisions repealed in 2021

The Owners Corporations and Other Acts Amendment Act 2021 (No. 4/2021),
commenced 1 December 2021, restructured the voting provisions. **Sections 91–94
no longer exist.** The current consolidation records:

> "Ss 91–93 **repealed** by No. 4/2021 s. 43." · "S. 94 substituted by No. 1/2010 s. 30, **repealed** by No. 4/2021 s. 43."
> — Act v023, Part 4 Div 7 (immediately after s 90).

The voting engine and meetings service cite the repealed numbers throughout
(`voting.ts:7-11`, `voting.ts:76`, `voting.ts:80`, `meetings.ts:410`,
`meetings.ts:437-441`, `meetings.ts:463`, `meetings.ts:482`, `meetings.ts:589-599`).
The *substance* mostly survives in renumbered form, so most behaviour remains
defensible — but the citations are wrong and two substantive changes made in
2021 are not reflected (see §5). Renumbering map:

| Code cites (pre-2021) | Current provision (post-No. 4/2021) | Substance |
|---|---|---|
| "s 91" (who may vote / one vote per lot) | **s 87** (substituted) | One vote per lot, at a meeting or by ballot |
| "s 92" (ordinary resolution majority) | **s 89(2)** | Simple majority of votes cast at the meeting |
| "s 92(3)–(5)" (poll) | **s 89(3)–(5)** | Poll by lot entitlement; may now be required "before **or after** the vote is taken"; must be by written vote |
| "s 94" (arrears bar) | **s 89B** | Arrears bar on voting, with special/unanimous carve-out and a 4-business-day cleared-funds rule |
| — (no code cite) | **s 89A** (new) | Chairperson's casting vote |
| — | **s 89C** (new) | Proxy formalities: prescribed form, 12-month lapse, arrears-holder bar |
| — | **s 89D** + reg 8A (new) | Proxy-farming caps |
| — | **s 89F–89H** (new) | Powers of attorney; ban on demanding proxies (60 pu); contract terms limiting votes void |

Two further 2021-adjacent notes: (i) s 119 was substantially rewritten
(subss (1)–(1D) substituted/inserted, tier system); (ii) s 122(2)(b)–(d), (3),
(4) and ss 122A–122B were inserted. Both current texts are set out below.

---

## 3. Manager registration and PI insurance — s 119, s 119A, Part 12, reg 10

### 3.1 What the Act says (verified text)

**s 119 — Appointment and removal of manager** (Act v023; AustLII cross-checked):

> "(1) A tier one owners corporation must appoint a person to be the manager of the owners corporation." *(substituted by No. 4/2021 s 51)*
> "(1A) Despite subsection (1), a tier one owners corporation, by special resolution, may opt out …"
> "(1C) A tier two … tier three … tier four … or … tier five owners corporation **may** appoint a person to be the manager …"
> "(1D) A person must not be appointed as the manager of an owners corporation for a period that exceeds 3 years."
> "(2) If the manager is to receive a fee or reward for carrying out the functions of manager, a person is not eligible to be appointed unless the person is a **registered manager**."
> "(3) An instrument or contract of appointment must be in the approved form."
> "(5) A person must not be appointed as a manager for fee or reward unless the person holds **professional indemnity insurance** that is sufficient to meet claims up to a level of the **prescribed amount** in any one year."
> "(6) An owners corporation may revoke the appointment of a manager."

Tier definitions (s 7, Act v023): tier one = more than 100 occupiable lots;
tier two = 51–100; tier three = 10–50; tier four = 3–9 (each excluding
services-only OCs); tier five = 2-lot subdivisions (s 7A).

**Reg 10 — Professional indemnity insurance** (Regs v002):

> "For the purposes of section 119(5) of the Act, the prescribed amount is **$2 000 000**."

**Part 12 — Registration of managers** (Act v023):

> **s 178**: "A person must not, alone or in partnership, carry out any function as the manager of an owners corporation **for fee or reward** unless the person is registered under this Part." Penalty: 60 penalty units.
> **s 182(2)**: "A registration remains in force until it is cancelled or surrendered."
> **s 183(1)**: "A registered manager must pay to the Business Licensing Authority the prescribed **annual registration fee** on the anniversary of the date the manager was last registered …" (with an annual statement, s 183(3)–(4)); automatic cancellation for non-compliance after notice (s 185).
> **s 185A(1)**: "A registered manager must, **at all times**, be covered by professional indemnity insurance in accordance with section 119(5)." *(inserted by No. 4/2021 s 76)*

Drafting anomaly, verified against the authorised PDF (p 16): the s 3
definition reads *"registered manager means a manager registered under
**Part 6**"* although the registration scheme sits in **Part 12**. Quoted as
found; counsel may wish to note it but it has no practical effect.

### 3.2 What the code does

- `managerRegistration.ts:33` — `MIN_PI_COVER_CENTS = 200_000_000` ($2M floor). Matches reg 10.
- `recordManagerRegistration` (`managerRegistration.ts:62-97`) captures the BLA registration number at organisation level and raises an annual `registration_renewal` review obligation. Its doc-comment correctly states registration is ongoing rather than annually renewed (matches s 182(2)); the annual review obligation approximates the s 183 annual fee/statement anniversary.
- `recordPiPolicy` (`managerRegistration.ts:136-182`) records PI policy periods, flags under-cover (`coverSufficient`) rather than rejecting it.
- `isContinuous` (`managerRegistration.ts:211-230`) checks gap-free PI cover reaching the present, conservatively treating unprovable seams as breaks — this operationalises s 185A(1) "at all times".
- `getRegistrationStatus` (`managerRegistration.ts:233-264`) treats a lapsed policy as insufficient cover regardless of amount.
- The compliance sweep (`compliance.ts:327-384`) escalates `registration_renewal` / `pi_expiry` at T-90/60/30/due/overdue.

### 3.3 Assessment

| Requirement | Code | Status |
|---|---|---|
| s 119(5) + reg 10: PI ≥ $2M | $2M floor enforced as a flag; lapse detected | **Compliant capture**, but under-cover is recorded, not blocked — acceptable as a monitoring platform; a gate would be needed if the platform itself effects appointments |
| s 185A: continuous PI, notify BLA on lapse | Continuity computed; **no BLA-notification workflow** | Gap (minor, procedural) |
| s 183: annual fee/statement anniversary | Annual review obligation keyed to a caller-supplied review date | Approximate — the obligation is not tied to the statutory registration anniversary |
| s 119(1D): 3-year maximum appointment term | **Not modelled anywhere** (no appointment/term entity, no compliance kind) | **Gap** |
| s 119(3) approved-form appointment; s 119A prohibited contract terms | Not modelled | Gap — only bites if GoodStrata (or a user) is an appointed manager |
| s 119(2) / s 178: registration precondition for fee-or-reward managing | The platform records a number; it does not verify it against the BLA register, and nothing gates platform features on registration | Counsel question below |

**Counsel questions (registration):**
1. Does Good Strata Pty Ltd's own operating model (software subscription to
   self-managing OCs) involve "carry[ing] out any function as the manager of an
   owners corporation for fee or reward" (s 178), particularly given the
   platform's *AI chair / meeting conductor* and automated notice-issuing
   features? This is the gating question for whether the company itself needs
   Part 12 registration and s 119(5) PI before go-live. `docs/REGISTERED-MANAGER-READINESS.md`
   exists in the repo and should be reviewed against this question.
2. For tier one customers (>100 lots): the platform should surface that a
   manager appointment is mandatory unless opted out by special resolution
   (s 119(1)–(1A)). No tier logic exists in the codebase at all.
3. Should the 3-year cap (s 119(1D)) be added as a compliance obligation kind?

---

## 4. OC money and trust accounts — s 122

### 4.1 What the Act says (verified text)

**s 122 — Duties of manager** (Act v023; AustLII cross-checked):

> "(2) A manager— (a) holds all money held on behalf of an owners corporation **on trust** for the owners corporation; and (b) if subsection (3) applies, must account separately for the money held by the manager for each owners corporation on the plan of subdivision; and **(c) subject to subsection (3), must hold all money held on behalf of separate owners corporations on trust in separate bank accounts**; and (d) must comply, as soon as practicable, with any reasonable request made by an owners corporation to provide copies of **financial statements of bank accounts** … for any period within **3 years** immediately preceding the request."
> "(3) Despite subsection (2)(c), a manager may hold money on behalf of separate owners corporations on trust **in the same bank account** if— (a) each owners corporation— (i) is on the **same plan of subdivision**; and (ii) has **consented** …; or (b) the bank account is a **statutory trust account** held by— (i) a licensed estate agent under the Estate Agents Act 1980; or (ii) an Australian legal practitioner …; or (iii) a licensee under the Conveyancers Act 2006."
> "(4) Money held by a manager on behalf of an owners corporation on trust for the owners corporation **includes any interest earned**."

Subsections (2)(b)–(d), (3) and (4) were inserted by No. 4/2021 s 53. Note the
duties in s 122 attach to "a manager" (defined via Part 6/s 119 appointment) —
they regulate manager-held money, not an OC's own self-held account.

### 4.2 What the code does

- `trustAccounts.ts:50-118` (`provisionTrustAccount`) provisions one segregated
  account per scheme, UNIQUE per (schemeId, kind); graceful-degradation to a
  `pending` account with manual payment instructions if the provider is down.
- `payments.ts` (integrations) — Monoova driver:
  - `createSchemeAccount` (`payments.ts:342-372`) creates a **per-OC Monoova
    "mAccount" (virtual collection account)** via `POST /financial/v2/accounts/create`
    with its own BSB + account number.
  - `createPaymentReference` (`payments.ts:374-395`) registers each levy
    notice's PayID **under that scheme's own account**, never a pool.
  - The driver comment (`payments.ts:186-199`) states the platform master NPP
    account (`MonoovaConfig.bankAccountNumber`, `payments.ts:209-210`) "is only
    the master/funding account the virtual accounts hang off — OCs' money is
    never pooled into it."
- `trustAccountForInboundPayment` (`trustAccounts.ts:209-214`) forces every
  inbound payment to reconcile against its own scheme's account.
- Levy issuance calls `ensureSchemeTrustAccount` before allocating PayIDs
  (`levies.ts:120-128`).

### 4.3 Assessment

| Requirement | Code | Status |
|---|---|---|
| s 122(2)(c): separate OCs' money in **separate bank accounts** | Separate *Monoova virtual accounts* (mAccounts) per OC, each with own BSB/account number, hanging off one platform master account | **The central open question — see below** |
| s 122(2)(b): separate accounting per OC | Per-scheme ledgering + reconciliation (`payments.ts` core service, `trustReconciliation.ts`) | Compliant in design (accounting separation exists independently of the bank-account question) |
| s 122(2)(d): produce bank statements on request, 3-year window | Transaction data retained; **no statement-production feature**; dependent on Monoova reporting per mAccount | Gap (buildable); counsel input on what satisfies "financial statements of bank accounts" |
| s 122(3) exceptions | Not relied on | N/A — note **(3)(b) offers no safe harbour for a fintech/platform account**; it covers only estate agents', lawyers' and conveyancers' statutory trust accounts |
| s 122(4): interest belongs to the OC | Not addressed in code or (as far as the repo shows) in commercial terms | Counsel question |
| s 122(2)(a): money held on trust | Segregation implemented; no declaration-of-trust documentation in repo | Counsel question (terms drafting) |

**The biggest counsel question in this document:** whether a Monoova mAccount
(a *virtual* account: a provider-side sub-ledger with its own BSB and account
number, where funds are held by Monoova's ADI arrangements rather than in a
bank account in the OC's or manager's name) is a "separate bank account" in
which money is "h[e]ld … on trust" within s 122(2)(c). Sub-questions:
1. At the ADI level, are all mAccount funds commingled in one omnibus account
   held by Monoova? If so, does BSB/account-number-level segregation plus
   per-OC accounting satisfy (2)(c), or does the subsection require distinct
   deposit accounts at an ADI?
2. Whose name is on the account — Monoova, Good Strata Pty Ltd, or the OC?
   s 122(2)(a) trust language suggests manager-as-trustee accounts are
   contemplated, but the interaction with a payments intermediary is not
   addressed by the Act.
3. Does s 122 apply at all where the OC is fully self-managed and GoodStrata is
   not an appointed manager (the duty attaches to "a manager")? If GoodStrata
   is never a s 119 manager, s 122 may not bind it — but then the marketing/
   compliance claims in code comments ("OC Act s 122") overstate, and the
   design should be justified under general trust/client-money principles
   instead.
4. Interest earned on mAccount balances (s 122(4)) — where does it go?

---

## 5. Meetings, quorum, voting — ss 72, 76–78, 83–97 + regs 7B, 8, 8A

### 5.1 What the Act says (verified text)

**Notice** — s 72(1): "The person convening an annual general meeting must give
notice in writing of the meeting to each lot owner **at least 14 days** before
the meeting." s 72(2) requires the notice to include, among other things: the
agenda; "the text of any special resolution or unanimous resolution to be
moved"; "the financial statements"; "the proposed annual budget"; a proxy-right
statement; any s 159 report; and the previous AGM minutes. s 76(1)–(2) is the
14-day SGM equivalent (shorter content list). A note confirms electronic
notice via the Electronic Transactions (Victoria) Act 2000.

**Quorum** — s 77 (amended by No. 4/2021 s 38):

> "A quorum for a general meeting is at least **50% of the total number of lots** or if 50% of the total number of lots is not available the quorum is at least **50% of the total lot entitlement**."

**No quorum** — s 78(1): the meeting "may proceed but all resolutions are
**interim resolutions**", with notice to owners within 14 days (s 78(2)) and
ripening after 29 days absent a challenge meeting (s 78(4)); interim
resolutions are unavailable for special/unanimous matters (s 78(5)).

**Ballots** — s 85(1): 14 days' written notice of a ballot. s 86(2)(a):

> "matters requiring an ordinary resolution must be passed by a majority of the votes returned by the closing date **but the number of votes returned must be not less than the number needed for a quorum** in accordance with section 77".

**Voting** (Part 4 Div 6 substituted by No. 4/2021 s 42):

> **s 87**: "For any resolution of an owners corporation, there is to be **one vote for each lot** …"
> **s 89(2)**: "Any matter (other than a matter requiring a special resolution or a unanimous resolution) must be determined at a meeting by a **simple majority of votes cast** at the meeting."
> **s 89(3)**: "At a meeting, a lot owner may (either in person or by proxy) **before or after the vote is taken** for an ordinary resolution, require that a **poll** be taken based on one vote for each unit of lot entitlement."
> **s 89(4)**: "Voting in a poll under subsection (3) must be by **written vote**."
> **s 89(5)**: "If a poll is required after the vote is taken … the decision … determined by a simple majority … has no effect and the decision on that matter is the decision of the poll."
> **s 89A**: chairperson has a casting vote if voting is equal and the chair is an owner/proxy (s 89A(1)); "If the voting on a resolution is equal and the chairperson does not exercise a casting vote, the resolution … is taken to **not be passed**" (s 89A(2)).
> **s 89B(1)**: "A lot owner who is **in arrears** for any amount owed … is not entitled to vote (either in person, by ballot or by proxy) on a resolution … unless the amount in arrears is paid in full." (2): despite (1), the owner "may vote on any matter where a **special resolution or unanimous resolution** is required." (3): the amount is taken to be paid in full only if paid "(a) in cash; or (b) otherwise, **not less than 4 business days** before the lot owner is required to vote".
> **s 89C**: proxies must be authorised in writing "in the **prescribed form**" delivered to the secretary (89C(3)); an authorisation "**lapses — (a) 12 months after it is given** …" (89C(6)); a non-owner proxy may not vote on the appointment/payment/removal of the manager (89C(7)); "If a lot owner is in arrears … the lot owner **must not — (a) vote as a proxy** on behalf of another lot owner …" (89C(10)).
> **s 89D(1)**: a person must not vote as proxy "(a) on behalf of more than one lot owner—if there are **20 or less occupiable lots** …; or (b) on behalf of more than **5% of the lot owners**—if there are more than 20 …" (family and reg 8A exceptions).
> **s 95**: unanimous resolution = "(a) if a ballot or poll is taken, the **total lot entitlements** of all the lots …; or (b) in any other case, the **total votes** for all the lots …".
> **s 96**: special resolution = "(a) if a ballot or poll is taken, **75% of the total lot entitlements** of all the lots …; or (b) in any other case, **75% of the total votes for all the lots**" (i.e. 75% of *all* lots' votes, not of votes cast).
> **s 97(1)**: ≥50% of total votes in favour and ≤25% against → "**interim special resolution**"; s 97(1A) (inserted 2021): quorate meeting + zero votes against also qualifies; ripens after 29 days absent a 25% petition (s 97(5)).

**Regulations**: reg 7B (inserted S.R. 147/2021) prescribes, for s 89(1)
voting, "completing a **form, whether hard copy or electronic**", with required
contents (plan number, lot, proxy name if any, closing date, resolution type,
motion text, abstention-implications statement, proxy-right statement, and
"(k) the **signature** of the lot owner or the proxy and the date of the
signature"). Reg 8: the prescribed proxy form is Schedule 1. Reg 8A: prescribed
circumstances excepting the s 89D caps (multi-lot owners; commercial/retail/
industrial developments).

### 5.2 What the code does

- `voting.ts:45-117` (`tallyMotion`): ordinary = headcount majority of votes
  cast (`forCount > againstCount`, `voting.ts:81`); poll demanded → entitlement
  weight (`voting.ts:77`); special = `forWeight ≥ 75% of totalEntitlement`
  (`voting.ts:87`); unanimous = `forWeight === totalEntitlement`
  (`voting.ts:91`). Duplicate votes per lot rejected (`voting.ts:54`).
- `voting.ts:131-134` (`quorumMet`): represented **entitlement** ≥ 50% of total
  entitlement — entitlement basis only.
- `meetings.ts:30`, `meetings.ts:94-191` (`sendMeetingNotice`): blocks non-committee
  meeting notices under 14 days (constant cites "s 71"); notice email contains
  title, time/place, agenda titles, and a proxy statement.
- `meetings.ts:442-495` (`demandPoll`): ordinary-only ✓; standing check (owner
  or proxy holder) ✓; **allowed only while the motion is open**
  (`meetings.ts:459-461`).
- `meetings.ts:532-636` (`castVote`): standing = owner or unexpired, unrevoked,
  meeting-scoped proxy (`meetings.ts:565-587`); arrears bar applied to
  **ordinary resolutions only** (`meetings.ts:589-599`); one vote per lot via
  DB conflict (`meetings.ts:613`).
- `meetings.ts:639-704` (`closeMotion`): row-locked tally, records basis and
  pollDemanded. **No quorum/returned-votes floor for motions not tied to a
  meeting** ("circular resolutions", `meetings.ts:574`).
- `meetings.ts:721-766` (`submitProxy`): grantor must own lot ✓; self-proxy
  blocked ✓; `expiresOn` **optional** — a standing proxy with no expiry never
  lapses; no prescribed-form capture; no cap on proxies held.
- `meetings.ts:794-835` (`quorumStatus`): entitlement-basis only; counts owners
  and valid proxy holders in attendance.
- `meetings.ts:838-890` (`closeMeeting`): records a `quorumMet` boolean; motion
  outcomes are unaffected by quorum.

### 5.3 Assessment

| Provision | Code behaviour | Status |
|---|---|---|
| s 72(1)/s 76(1) 14-day notice | Enforced (`meetings.ts:102-111`) | **Compliant** (comment cites "s 71" — should read ss 72/76) |
| s 72(2) AGM notice contents | Agenda + proxy statement only; no financial statements, budget, special-resolution text, s 159 report, prior minutes | **Gap** — AGM notices are content-deficient |
| s 87 one vote per lot | Headcount default, dup-guarded | Compliant |
| s 89(2) simple majority of votes cast | `forCount > againstCount` | Compliant |
| s 89(3) poll before **or after** the vote | Poll demandable only while voting is open; rejected after close | **Gap** — a poll demanded after declaration must displace the headcount result (s 89(5)); the platform forecloses it at close |
| s 89(4) poll by written vote; reg 7B form contents (incl. signature) | In-app votes; no form artefact, no signature capture | **Counsel question** — does an authenticated in-app ballot record satisfy "written vote" and reg 7B(k) "signature"? (Electronic Transactions Act may assist) |
| s 89A casting vote | No mechanism; tie → not carried | Default outcome matches s 89A(2); the chair's *option* is not offered — minor feature gap |
| s 89B(1)–(2) arrears bar | Barred from ordinary only; special/unanimous allowed | **Net effect matches** (bar minus carve-out = ordinary-only), but code reasons from repealed s 94 |
| s 89B(3) 4-business-day cleared-funds rule | Live arrears check at cast time; a same-day electronic payment immediately re-enfranchises | **Gap** (nuance) |
| s 89C(10) owner-in-arrears may not act as proxy | Not checked — an arrears owner can cast votes for other lots via proxy | **Gap** |
| s 89C(3)/reg 8 prescribed proxy form | Digital record only; no Sch 1 form | Counsel question |
| s 89C(6) 12-month proxy lapse | Optional `expiresOn`; standing proxies can live forever | **Gap** — statutory maximum not enforced |
| s 89C(7) non-owner proxy barred from manager-appointment votes | Not enforced | Gap (narrow) |
| s 89D/reg 8A proxy caps (1 / 5%) | No cap of any kind | **Gap** |
| s 77 quorum | Entitlement basis only; statute's primary basis is **number of lots**, entitlement only as fallback | **Mismatch** — a meeting could be quorate on lot-count but fail the code's entitlement test, or vice versa |
| s 78 interim resolutions when inquorate | None — motions resolve identically with or without quorum; quorum recorded as a boolean | **Gap** — inquorate outcomes should be interim, notified within 14 days, ripening at 29 days |
| s 85/s 86(2)(a) ballots (≙ "circular resolutions") | No 14-day ballot notice; no returned-votes ≥ quorum floor at close | **Gap** for meeting-less motions |
| s 95 unanimous | All entitlement in favour (implies every lot voted for) | Compliant on the strictest reading of both limbs |
| s 96 special | Always 75% of total entitlements (limb (a)) | Compliant where a ballot/poll is taken; **counsel question** whether limb (b) (75% of all lots' votes) should govern votes taken at a meeting without a poll |
| s 97 interim special resolutions | A special resolution reaching 50–74.99% is simply "lost" | **Gap** — the statute converts it into an interim special resolution with a 29-day ripening/petition process (incl. the 2021 s 97(1A) zero-against pathway) |

---

## 6. Grievances and dispute resolution — Part 10 (ss 152–159) + Model Rule 7

### 6.1 What the Act and Regulations say (verified text)

> **s 152(1)**: "A lot owner or an occupier of a lot or a manager may make a complaint to the owners corporation about an alleged breach … of an obligation imposed on that person by this Act or the regulations or the rules …"
> **s 152(2)**: "A complaint must be made **in writing in the approved form**." (3): the OC "must make a copy of the approved form available" on request. (4): no complaint "in relation to a personal injury or the recovery of any fees, charges, contribution or amount owing … under section 28."
> **s 153(2)**: on a complaint the OC "must decide— (a) to take action under this Part …; or (b) to apply to VCAT …; or (c) to take no action …". **s 153(3)**: no Part 10 action or VCAT application "unless— (a) the **dispute resolution process required by the rules has first been followed**; and (b) the owners corporation is satisfied that the matter has not been resolved through that process."
> **s 154(1)–(2)**: if the OC decides not to act, it "**must give notice of the decision**" to the complainant, and "the notice must set out the **reasons**".
> **s 155(2)**: a notice to rectify "must specify the alleged breach and require the person … to **rectify the breach within 28 days** after the date of the notice." (3): approved form. (4): copy to the lot owner where the respondent is an occupier.
> **s 156**: on non-rectification the OC may give more time, give a final notice, or drop the matter — with notice of its decision to both complainant and respondent (s 156(4)).
> **s 157(1)**: a final notice must be in the approved form, give a further **28 days**, and state that VCAT may follow. (2)–(3): decision + notices.
> **s 158**: service methods (post, personal, letterbox, occupier over 16, nominated address); 2021 note confirms electronic service via the Electronic Transactions (Victoria) Act 2000.
> **s 159(1)**: the OC "must report to the annual general meeting" the number and nature of complaints, actions taken, VCAT applications and outcomes. **s 159(2)**: "The report **must not identify** the person who made a complaint or the lot owner or occupier alleged to have committed the breach."

**Model Rule 7 — Dispute resolution** (Regulations, Sch 2; prescribed as the
default rules by reg 11 for s 139(1) of the Act; rule 7 amended by S.R.
147/2021):

> "(1) The grievance procedure set out in this rule applies to disputes involving a lot owner, manager, or an occupier or the owners corporation. (2) The party making the complaint must prepare a **written statement in the approved form**. (3) If there is a **grievance committee** … it must be notified … (4) If there is no grievance committee, the owners corporation must be notified … (5) The parties to the dispute must **meet and discuss** the matter in dispute, along with either the grievance committee or the owners corporation, **within 28 calendar days** after the dispute comes to the attention of all the parties. (5A) A meeting under subrule (5) may be held in person or by teleconferencing, including by **videoconference**. … (7) If the dispute is not resolved, the grievance committee or owners corporation must **notify each party of the party's right to take further action under Part 10** … (8) This process is separate from and does not limit any further action under Part 10 …"

(Model Rule 7 is the *default*; an OC with registered custom rules must have
some dispute-resolution process, and s 153(3) points to "the rules" actually
in force.)

### 6.2 What the code does

- `grievances.ts:32` — `STATUTORY_DAYS = 28` drives both the complaint
  `meetByDate` (`grievances.ts:148`) and breach-notice `rectifyByDate`
  (`grievances.ts:340`).
- `fileComplaint` (`grievances.ts:136-192`): intake with `approvedForm`
  boolean (default **false**, `grievances.ts:40`); non-approved-form filings
  are accepted and annotated (`grievances.ts:171-174`).
- State machine (`grievances.ts:78-86`): received → under_discussion →
  notice_to_rectify → final_notice → vcat, with resolved/withdrawn exits;
  illegal jumps rejected; full audit trail in `complaint_events`.
- `issueBreachNotice` / `closeBreachNotice` (`grievances.ts:324-470`): notice
  to rectify and final notice types, 28-day clocks, outcomes
  rectified/escalated/withdrawn.
- `generateS159Report` (`grievances.ts:530-577`): period-scoped counts by
  status **plus `items: Complaint[]` — the full complaint rows, including
  `complainantPersonId`, `respondentPersonId`, `subject` and `details`**
  (`grievances.ts:486-502`, `565-576`).

### 6.3 Assessment

| Provision | Code behaviour | Status |
|---|---|---|
| MR 7(5) meet-and-discuss within 28 days | 28-day `meetByDate` from `receivedAt` | Compliant in substance; statute runs the clock from when the dispute "comes to the attention of **all the parties**", code from receipt — minor variance, conservative direction |
| MR 7(5A) videoconference meeting | Daily.co rooms exist for meetings | Supported |
| MR 7(3)–(4) grievance-committee routing | No grievance-committee concept | Gap (minor — OC-level routing is the fallback the rule itself allows) |
| MR 7(7) notify parties of Part 10 rights | Not automated | Gap (minor) |
| s 152(2) approved form | Boolean flag; non-form complaints accepted | **Counsel question**: is the platform's digital intake itself capable of being "the approved form" (CAV-approved), and should non-form filings be blocked or converted? |
| s 152(4) excluded subject matter (personal injury; s 28 fee recovery) | Not screened at intake | Gap (minor; validation) |
| s 153(3) rules-process-first before Part 10/VCAT | State machine forces `under_discussion` before `notice_to_rectify`/`vcat` | **Compliant** in sequencing; no evidence capture that the meet-and-discuss actually occurred |
| s 154 notice + reasons when no action taken | Not modelled — a complaint can be closed with an optional note, but no notice artefact to the complainant | **Gap** |
| s 155(2)–(3) notice to rectify, 28 days, approved form | 28-day clock ✓; no approved-form template; occupier→owner copy (s 155(4)) not modelled | Partial |
| s 156 more-time pathway + decision notices | No "more time" state; decision notices not generated | Partial gap |
| s 157 final notice, 28 days, VCAT statement | Clock ✓, type ✓; content requirements not templated | Partial |
| s 158 service methods | Email delivery (ETA-consistent) | Compliant, subject to service-formality review |
| s 159(1) AGM report contents | Counts + items | Broadly covers (a)–(d); VCAT counts derivable from status |
| **s 159(2) anonymity** | Report embeds complainant/respondent IDs and free-text details | **Non-compliant if tabled as generated** — the statutory report must be de-identified. Highest-priority Part 10 fix |

---

## 7. Ranked discrepancy summary (for counsel prioritisation)

1. **s 122(2)(c) "separate bank accounts" vs Monoova virtual accounts.** The
   entire payments architecture (`payments.ts`, `trustAccounts.ts`) turns on
   per-OC *virtual* accounts under one platform master NPP account. Whether
   that satisfies "separate bank accounts … on trust" — and whether s 122
   binds GoodStrata at all if it is not an appointed manager — is the
   threshold legal question for the money loop. No s 122(3) exception is
   available to a platform.
2. **Whether GoodStrata needs Part 12 registration itself** (s 178, 60 pu;
   s 119(2)/(5) + reg 10 $2M PI). The AI-chair conductor, automated statutory
   notices and levy administration may amount to "carry[ing] out any function
   as the manager … for fee or reward".
3. **The voting engine implements the pre-2021 statute.** Outcomes mostly
   coincide, but: post-declaration poll demands are refused (s 89(3)/(5));
   the s 89B(3) 4-business-day cleared-funds rule is absent; an owner in
   arrears can still vote as proxy for others (s 89C(10)); and all code
   citations reference repealed ss 91–94.
4. **Quorum and interim-resolution machinery.** Quorum uses the wrong primary
   basis (entitlement instead of lot count, s 77); inquorate meetings produce
   final rather than interim resolutions (s 78); failed specials in the
   50–75% band are not treated as interim special resolutions (s 97, incl.
   the 2021 zero-against pathway); meeting-less "circular" motions lack the
   ballot safeguards (s 85 14-day notice; s 86(2)(a) returned-votes ≥ quorum).
5. **Proxy controls.** No 12-month lapse (s 89C(6)), no farming caps
   (s 89D/reg 8A), no prescribed form (reg 8/Sch 1), no bar on non-owner
   proxies voting on manager appointment (s 89C(7)).
6. **s 159(2) de-identification.** The generated AGM grievance report embeds
   complainant/respondent identities and complaint details; the statute
   forbids identifying either party.
7. **AGM notice contents (s 72(2)).** Financial statements, budget,
   special-resolution text, s 159 report and prior minutes are statutorily
   required inclusions that the notice email omits.
8. **Part 10 procedural artefacts.** No s 154 "no action" notice with
   reasons; no s 156 more-time pathway or decision notices; approved-form
   complaints/notices not templated.
9. **Manager-appointment lifecycle.** 3-year cap (s 119(1D)), approved-form
   appointment (s 119(3)) and s 119A prohibited contract terms unmodelled;
   PI-lapse BLA notification (s 185A(2)) not workflow-ed.

## 8. Verification status and caveats

- All quoted provisions were extracted from the **authorised Victorian
  consolidations** identified in §1 (Act Version 023; Regulations Version 002)
  on 5 July 2026. Nothing in this document relies on secondary commentary.
- Regulations Version 002 is the current in-force consolidation per
  legislation.vic.gov.au as at retrieval; counsel should confirm no
  post-1 Dec 2021 statutory rule amends Sch 2 that has not yet been
  consolidated (none was surfaced in the in-force register at retrieval).
- The Act's margin notes in v023 reference amending Acts No. 40/2024 and
  No. 46/2025 (short-stay and eligibility provisions respectively); neither
  altered the provisions mapped above, but counsel should confirm no
  uncommenced amendments are pending for ss 77–97, 119, 122 or Part 10.
- s 3 definition anomaly ("registered manager means a manager registered under
  **Part 6**", authorised PDF p 16, where the scheme sits in Part 12) is
  quoted as found.
- Code references are to the working tree at commit `c55b28b` (branch HEAD,
  5 July 2026) and will drift as the codebase changes.
- **UNVERIFIED:** nothing quoted above is unverified. Provisions *referred to*
  but not re-verified word-for-word: ss 7/7A tier definitions (extracted from
  v023 but quoted in paraphrase), s 28 (fee recovery), s 139(1) (model rules
  default), ss 80–81 (participation/minutes), s 113 (committee notice), and
  Sch 1 of the Regulations (proxy form). Counsel should pull these directly
  if they become load-bearing.

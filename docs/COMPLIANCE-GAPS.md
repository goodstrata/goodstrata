# GoodStrata — Compliance Gap Report (Victoria)

**Owners Corporations Act 2006 (Vic) · OC Regulations 2018 (Vic) · OCOAA 2021 · adjacent Commonwealth obligations**

Version: 2026-07-03 · Prepared as a product/engineering compliance-gap assessment for Good Strata Pty Ltd (ACN 684 135 760)

---

## ⚠️ NON-LEGAL-ADVICE DISCLAIMER

**This is a product and engineering compliance-gap assessment, NOT legal advice.** It maps what the GoodStrata codebase currently implements against obligations in the Owners Corporations Act 2006 (Vic), the Owners Corporations Regulations 2018 (Vic), the Owners Corporations and Other Acts Amendment Act 2021 (Vic), and adjacent Commonwealth law (Privacy Act 1988, Corporations Act 2001, Competition and Consumer Act 2010). Section and regulation numbers were checked against primary sources (legislation.vic.gov.au / AustLII) and Consumer Affairs Victoria (CAV) guidance where possible; items that could not be verified against a current primary consolidation are explicitly flagged **"needs legal confirmation"**. Some 2021-amendment renumbering and several OC Regulations 2018 sub-numbers were **not** independently verified.

**Good Strata Pty Ltd must have this report reviewed by a qualified Australian lawyer (strata + financial-services + privacy) before relying on any part of it.** Nothing here should be treated as a definitive statement of the law or of GoodStrata's legal exposure.

---

## 1. Executive Summary

GoodStrata implements a **credible governance and finance skeleton** — meeting creation with a 14-day notice gate, entitlement-weighted motions, a proxy record, quorum calculation, an AI chair/conductor, per-scheme ledgers, an append-only audit spine, a strong APP-aligned privacy policy, and correctly-scaffolded (but largely unused) schema for insurance, maintenance, compliance calendar, and documents. The **audit trail / automated-action accountability posture is a genuine strength.**

However, the platform is positioned to *"replace the human strata manager entirely"* and hold/move owners-corporation money, and against that ambition there are **three blocker-level defects** and a broad band of high-severity gaps where statutory artefacts are either absent or only aspirational in the SPEC:

**Top blockers (fix before onboarding paying schemes or taking live money):**

1. **Trust-money commingling (Platform / OC Act s 122(2)(c)).** Every Monoova PayID resolves to a single shared platform NPP account, so money from many unrelated owners corporations across different plans of subdivision is pooled in one account with segregation existing only at the ledger layer. The Act requires **separate bank accounts per OC**; none of the s 122(3) exceptions apply. This is the single most serious code-level finding.
2. **Ordinary resolutions decided by lot entitlement, not one-vote-per-lot (Meetings / OC Act s 91, s 92(2)).** `tallyMotion()` sums entitlement weight for ordinary resolutions, so a minority of lots holding large entitlements can carry or defeat a resolution the Act says is one-vote-per-lot — producing **legally wrong meeting outcomes**.
3. **Mandatory internal grievance / dispute procedure entirely absent (Rules & Disputes / Model Rule 7, OC Act s 152–159).** There is no complaint entity, approved-form intake, 28-day meet-and-discuss clock, breach-notice machinery, or s 159 AGM report anywhere in the codebase. The enforcement/dispute half of the manager's statutory role is missing.

**Cross-cutting theme:** the enabling schema exists (`complianceObligations`, `insurancePolicies`, `maintenancePlans`, `assets`, document `retentionUntil`, enum values `certificate`/`certificate_fee`/`breach_notice`/`agm_due`) but **no service reads or writes it** — the compliance calendar that the SPEC relies on to deliver insurance-renewal, valuation, ESM, and certificate-deadline reminders is completely unimplemented, and much of the promised functionality is SPEC aspiration with no code path.

Additionally, the brief's premise that *"Victoria does not license strata managers"* is **incorrect** — paid/rewarded OC managers must be registered with the Business Licensing Authority (s 119(2)), hold PI insurance (s 119(5)), and hold OC money on trust in separate accounts (s 122). This registration/characterisation question is the largest single exposure cluster for the hosted business model.

### Gap counts

| Severity | Count |
|---|---|
| 🔴 Blocker | 3 |
| 🟠 High | 35 |
| 🟡 Medium | 34 |
| ⚪ Low | 18 |
| **Total obligations assessed** | **90** |

> **Coverage:** All six domains — meetings, financial, insurance/maintenance, records/certificates, rules/disputes, and platform posture — are now assessed (§2.6 Financial Management was completed in a second pass). The **tier-to-section mapping for the audit/review-of-accounts obligation (s 35)** and several Part 3 sub-numbers post-OCOAA-2021 remain **unverified** against a current primary consolidation — see §5.

---

## 2. Domain Audits

Status legend: **IMPLEMENTED** / **PARTIAL** / **ABSENT** / **UNCLEAR**. Severity: 🔴 blocker · 🟠 high · 🟡 medium · ⚪ low.

### 2.1 Meetings, Resolutions & Committee Governance
*OC Act 2006 Part 4 (ss 69–99), Part 5 (ss 100–118), OCOAA 2021 amendments, OC Regs 2018.*

| Obligation | Statutory basis | Tier | Status | Gap | Sev. | Recommendation |
|---|---|---|---|---|---|---|
| Ordinary resolutions = one vote per lot, simple majority of votes cast; entitlement poll only on demand | s 91, s 92(2)–(5), ss 95–96 | All | PARTIAL | `voting.ts tallyMotion()` sums entitlement weight for ordinary resolutions; no poll-on-demand — minority of high-entitlement lots can wrongly carry/defeat | 🔴 | Model one-vote-per-lot by default; add explicit poll flag re-tallying on entitlement per s 92(3)–(5) |
| Meetings without quorum produce interim resolutions (14-day notice, 29-day hold); interim special resolutions | s 78, s 97 | All | ABSENT | Outcomes treated as final regardless of quorum; no `interim` state, no 14/29-day machinery, no 25% petition path | 🟠 | Add interim state keyed off `quorumMet` + s 97 thresholds; emit 14-day interim notice; enforce 29-day hold; petition path |
| AGM/SGM notice contents (financials, budget, resolution text, reports, previous minutes, proxy statement) | s 72(2), s 76(2) | All | PARTIAL | `sendMeetingNotice()` sends only title/when/where/agenda titles + generic proxy line; no statutory attachments; comment mis-cites "s 71" | 🟠 | Assemble full s 72/76 notice pack; block issue if a special/unanimous motion has no text; fix citation to s 72 |
| Must hold AGM if money received/paid; ≤15 months between AGMs | s 69(1)–(2) | All (that handle money) | ABSENT | No compliance service; `agm_due` enum unused; SPEC §3.1 promises 15-month monitoring but nothing computes it | 🟠 | On AGM close compute `nextAgmDueBy = lastAgm + 15mo`; raise `agm_due` obligation with escalating reminders |
| Minutes must record names present, proxy-grantors, proxies present, voting, resolution text | s 81(2), s 114(3) | All | PARTIAL | AI drafter never receives attendance/proxy names; `meetingDetail()` returns none — cannot satisfy s 81(2)(b)-(d) | 🟠 | Feed attendance roll + proxy register into `buildContext`; template mandatory fields deterministically, LLM drafts narrative only |
| 13+ lot OC must elect committee at each AGM; s 103 membership constraints | s 100(1), s 103(1)–(7) | 13+ lots (mand.) | ABSENT | Only manual `assignCommitteeRole()`; no election, no lot-owner/proxy check, 3–12 bounds, one-per-lot, arrears suspension | 🟠 | Build AGM committee-election flow + enforce s 103 constraints linked to arrears service |
| Proxy vote caps (max 1 lot ≤20 occupiable lots; 5% if >20) | OCOAA 2021 (likely new s 89A / amended s 87) — **unverified** | Tier-dependent | ABSENT | `submitProxy()/castVote()` enforce only self-proxy prohibition; no per-holder cap, occupiable-lot count, or family exception | 🟠 | Add occupiable-lot count + enforce cap at cast time with family exception. **Confirm section with counsel** |
| AGM agenda mandatory items (committee election, financials, budget, insurance/fees, delegations, reports, previous minutes) | s 71(2)(a)–(i) | All (AGM) | ABSENT | `createMeeting()` takes free-form agenda; no required/auto-populated s 71(2) items | 🟠 | Seed & require s 71(2) items (incl. s 115 committee report, s 159 dispute report) before notice issues |
| Committee-meeting procedure (3-business-day notice, half-member quorum, casting vote, s 114 minutes, 14-day ballots) | s 108, s 109(2)–(3), s 111, s 112, s 114 | Committees | PARTIAL | Committee decisions run through `decisions.ts` (majority of role-holders); notice-period skipped; no quorum/casting vote/s 114 minutes | 🟡 | Add compliant committee-meeting/ballot flow, or document `decisions.ts` as internal approval only |
| Arrears bar on ordinary resolutions; special/unanimous always allowed; 4-business-day non-cash rule | s 94(1)–(3) | All | PARTIAL | Substantively correct BUT mis-cited as "s 89" (anti-coercion) in code + SPEC; s 94(3) 4-day cut-off not applied | 🟡 | Rename citation s 89→s 94 across code/SPEC; apply 4-business-day non-cash cut-off |
| Proxy form: prescribed form, 12-month lapse, revocable, s 87(4) subject-matter limits | s 87(3)–(4) | All | PARTIAL | Null `expiresOn` never lapses; prescribed form (`documentId`) not captured; no s 87(4) restriction | 🟡 | Default expiry to grant+12mo; require uploaded form; block non-owner proxy on Part 6/s 11 matters |
| SGM convening incl. 25%-entitlement requisition; requisitioner agenda binding | s 74, s 75(2) | All | ABSENT | Lot owners cannot create/requisition a meeting; no 25% validation | 🟡 | Add lot-owner SGM requisition flow validating 25% entitlement + carry approved agenda |
| Office-holders: chair/secretary election/appointment + removal | s 98, s 99, s 105–107 | All | PARTIAL | Set by admin assignment, not committee-majority-vote/lot-owner election; "treasurer" wrongly modelled as statutory office | 🟡 | Drive from committee vote / lot-owner election; treasurer = internal role only |
| Out-of-session ballots (≥14-day notice + contents, closing date, quorum-of-returns) | s 83–86 | All | ABSENT | Schema anticipates ballots but no lifecycle: no 14-day notice, closing date, or s 86(2)(a) returns test | 🟡 | Implement ballot object with arranger authority, 14-day notice, hard close, minimum-returns check |
| Quorum = 50% of total votes (per lot), entitlement fallback; count POA holders | s 77 | All | PARTIAL | Only entitlement limb implemented; primary per-lot test absent; no POA concept | 🟡 | Implement per-lot quorum with entitlement fallback; count POA holders |
| Chair casting vote on tie (if lot owner/proxy) | s 93, s 112(9) | All | ABSENT | No casting-vote path; tie=not passed only coincidentally matches s 93(2) | 🟡 | Add optional chair casting vote gated on eligibility |
| Committee report to each AGM | s 115, s 71(2)(h) | Committees | ABSENT | No committee-report generation; not seeded onto AGM agenda | 🟡 | Auto-compile committee activity report as required AGM item |
| Casual committee vacancies (co-option; non-voting co-opted members) | s 104, s 110, s 112(5) | Committees | ABSENT | No casual-vacancy/co-option concept | ⚪ | Add co-option + non-voting co-opted member type |
| Committee member duties & immunity | s 117, s 118 | Committees | UNCLEAR | Conduct/liability rules, not system functions; no onboarding acknowledgement | ⚪ | Surface duties in onboarding; record acknowledgement |
| Remote participation (teleconferencing; deemed present) | s 80, s 92(6), s 112(4)/(10) | All | IMPLEMENTED | Daily.co video, attendance modes, online attendees counted | ⚪ | Confirm OC Regs 2018 teleconferencing manner; tie proxy-mode attendance to proxy register |
| 5-tier classification by occupiable lots | Tier defs inserted by OCOAA 2021 — **unverified** | Tier-dependent | PARTIAL | `schemeTier()` bands wrong (10→T4 not T3; uses raw not occupiable lots; T5 only <3) | ⚪ | Recompute on occupiable lots with exact bands; keep 13-lot committee rule independent of tier |

### 2.2 Insurance & Property Maintenance
*OC Act 2006 (insurance ss 54–65; maintenance ss 36–49) + Building Regulations 2018 (Vic) Part 15.*

| Obligation | Statutory basis | Tier | Status | Gap | Sev. | Recommendation |
|---|---|---|---|---|---|---|
| Reinstatement & replacement insurance for common-property buildings (ongoing duty) | s 59 (with s 54; exemptions s 63/64/tier-5) | All except T5 | PARTIAL | Activation gated only on existence of any `category="insurance"` document; no policy-type/sum-insured check, no ongoing monitoring; `insurancePolicies` is dead schema | 🟠 | Build insurance service persisting policies; require current building policy before activation; scheduled expiry monitor |
| Public liability ≥ $20,000,000 per claim & aggregate | s 60(3) (amended Act 4/2021 s 30) | All w/ common property except T5 | ABSENT | PL policy never captured; $20M minimum never enforced | 🟠 | Capture PL policy; validate limit ≥ $20M (configurable); block activation if missing/under-limit |
| Valuation ≥ every 5 years; sum insured > building value; table report at GM | s 65(1)–(3) (subst. Act 4/2021 s 33) | All except T5 | ABSENT | No valuation tracking; 5-year cycle unscheduled; no valued amount stored; SPEC §5.1 promises reminders, none exist | 🟠 | Store last-valuation date/amount; auto-create 5-year `valuation` obligation; renewal warning; table report at next GM |
| Maintenance plan (10-year major capital items) | s 36 (mand. T1/T2), s 37, s 38, s 39; transitional s 207 | Mand. T1/T2; opt. T3–5 | ABSENT | `maintenancePlans` models recurring services, not s 37 capital-items plan; `assets` unused; SPEC serves "Tier 2-5" yet cannot produce a T2 plan | 🟠 | Either restrict onboarding to T3–5 (document T1/T2 unsupported) OR build s 37 plan + approval workflow; gate on plan when tier ≤ 2 |
| Essential Safety Measures maintenance + Annual ESM Report | Building Regs 2018 Part 15 (commonly reg 223) — **reg numbers unverified**; Building Act 1993 | Class 2 / apartment OCs | ABSENT | `isEsm` flag + `esm_inspection` kind unused; no AESMR tracking — life-safety exposure | 🟠 | Schedule ESM from `maintenancePlans(isEsm)`; track AESMR currency. **Confirm reg numbers with building surveyor/lawyer** |
| Live compliance calendar (renewal/valuation/ESM reminders) | Supports ss 59/60/65 + Building Regs; SPEC §6.4 | All | ABSENT | `complianceObligations` schema exists but **no code inserts/reads it**; `notifier.ts` handles no such events | 🟠 | Implement compliance service generating/aging obligations; wire notifier for 90/60/30-day escalation |
| Repair & maintain common property; distinguish common vs lot | s 46, s 47, s 47A, s 48, s 49 | All | PARTIAL | Served reactively only; common-vs-lot decided by LLM triage with no plan-of-subdivision/boundary source; no preventive dispatch | 🟡 | Anchor determination to structured common-property data; add owner escalation path; scheduled preventive maintenance |
| Disclose insurance particulars on register + in OC certificate | s 148(j), s 150, s 146, s 151; OC Regs 2018 — **form no. unverified** | All | ABSENT | No structured insurance register; PDF certificate only; s 151 generation absent | 🟡 | Populate register from `insurancePolicies`; expose to owners; implement s 151 certificate |
| Correct 5-tier classification (drives duties) | s 7, s 7A (2-lot), s 8 (services-only) | All | PARTIAL | Off-by-one at 10 lots; raw not occupiable lots; services-only never T5 | 🟡 | Fix boundary to ≥10 for T3; base on occupiable lots; add s 7A/s 8 detection; boundary unit tests |
| Manager insurance commission / beneficial-relationship disclosure | s 122A, s 122B | Where GoodStrata places insurance | ABSENT | Captures incumbent competitor's commission but no mechanism to disclose GoodStrata's own | 🟡 | Add manager-disclosure record surfaced to owners; keep insurance to admin support until AFSL/AR + disclosure exist |
| Maintenance fund (once plan approved) + payment controls | s 40, ss 42–45 | OC w/ approved plan | PARTIAL | `maintenance` fund row created for every scheme; not tied to a plan; s 42–45 controls not enforced | ⚪ | Link fund to approved plan; enforce extraordinary-payment special-resolution controls |

### 2.3 Records, Registers, Certificates & Information Access
*OC Act 2006 Part 9 (ss 144–151) + OC Regs 2018 (rr 12–17).*

| Obligation | Statutory basis | Tier | Status | Gap | Sev. | Recommendation |
|---|---|---|---|---|---|---|
| Keep ~19 prescribed record classes | s 144; OC Regs r 11A (sub-no. **unverified**) | All | PARTIAL | No s 144 inventory; lot import captures owner name/email but **not address** (s 144(a)); ballots/proxies not retained as records | 🟠 | Records-coverage model mapping every class to storage; capture owner postal address; completeness check |
| Retention minimums (12mo ballots/proxies; 7yr others) | s 145(1)–(3) | All | PARTIAL | `retentionUntil` set only for `financial` docs; ~18 other classes null; ballot/proxy 12-month rule unmodelled; no disposal sweep | 🟠 | Compute retention per class; store on votes/proxies; add retention/disposal sweep + permanent-keep list |
| Records inspection free to owner/mortgagee/purchaser/representative + copies capped | s 146(1)–(3) (amended 4/2021 s 62); OC Regs r 12 | All | PARTIAL | Access limited to authenticated scheme members — no path for mortgagees/purchasers/reps; only docs exposed, not ballots/proxies/register; `accessLevel` could unlawfully hide a s 144 record from an owner | 🟠 | Identity-captured inspection flow; never hide a s 144 record from an owner; copy provision capped at r 12 |
| Establish & maintain OC register | s 147(1)–(3) | All | ABSENT | No register table/service/route anywhere | 🟠 | Introduce register construct rebuilt from data spine + updated by domain events |
| Register prescribed particulars | s 148(a)–(j) | All | ABSENT | No storage for manager reg no., liability basis, rule-amendment dates, notices/orders, contract/lease/licence particulars, premium due/last-paid dates | 🟠 | Extend schema for missing s 148 fields; project into register artefact |
| Manager registration number on register/certificate | s 148(c), s 151(4)(a)(xii); Part 6 / OC Regs rr 19–21A | All (registered mgr) | ABSENT | `organizations` has no registration-number field — foundational given GoodStrata-as-manager thesis | 🟠 | Add manager registration number + registered contact; feed register (c) and certificate (xii) |
| OC certificate within 10 business days, prescribed contents + attachments | s 151(1),(3),(4) (amended 4/2021 s 64); OC Regs rr 16–17 (Sch 3) | All | ABSENT | No certificate service/table/route; `certificate`/`certificate_fee` enums unused; SPEC mislabels it "Section 32 certificates" | 🟠 | Build s 151 certificate generator (13 content items + rules + Sch 3 statement + last-AGM resolutions), 10-business-day SLA, execution under s 20. **Top priority for this domain** |
| Register availability + copy-fee cap + commercial-purpose consent | s 150(1)–(3), s 150(2A) (ins. 4/2021 s 63); OC Regs r 13 | All | ABSENT | Whole s 150 regime missing incl. commercial-purpose restriction | 🟡 | Add register inspection (free) + copy (≤ r 13) endpoints + s 150(2A) consent gate |
| Certificate fee ≤ prescribed max (+ urgent tier), GST; overcharge = offence | s 151(2),(5) (60 penalty units); OC Regs rr 14–15 | All | ABSENT | No fee logic; overcharge exposure | 🟡 | Encode r 14 max (standard + urgent) + r 15 GST; hard-cap; version for indexation |
| Honour VCAT access-restriction orders + APP handling of register data | s 146/150 read w/ VCAT power; Privacy Act APPs 10–13 | All | ABSENT | No per-person access-restriction flag; no APP 12/13 access/correction; indefinite retention tension w/ APP 11.2 | 🟡 | Per-person restriction flag; APP 12/13 workflow; align disposal with retention minimums |
| Receive/retain developer initial-records handover | Part 9 handover (~s 143/143A — **section unverified**) | All | PARTIAL | Ad-hoc upload; no checklist, no first-meeting trigger, no T1/T2 maintenance-plan distinction | ⚪ | Onboarding handover checklist mapped to statutory list; flag missing items. **Confirm section** |

### 2.4 Rules, Grievances & Dispute Resolution
*OC Act 2006 Part 8 (rules) + Parts 10–11 (disputes); OC Regs 2018 Sch 2 model rules.*

| Obligation | Statutory basis | Tier | Status | Gap | Sev. | Recommendation |
|---|---|---|---|---|---|---|
| Mandatory internal grievance procedure (approved-form statement, meet within 28 days, notify rights) | OC Regs Sch 2 Model Rule 7; applied by s 139(3) | All | ABSENT | **No grievance/complaint entity, form, or service exists.** `community.ts` is a social feed, not a grievance workflow. SPEC §7.3 describes exactly this — unbuilt | 🔴 | Build grievances module: approved-form intake, respondent linkage, committee notification, 28-day meeting scheduler, auto Part 10 rights notice. Foundational |
| Model rules applied by default; operative rule set held per scheme | s 139; OC Regs r 11 & Sch 2 | All | ABSENT | No rules entity; rules only a document category; `createScheme()` applies no rule set — contradicts SPEC §1.1/§6.3 | 🟠 | Add `scheme_rules` table seeded with Sch 2 model-rule text on scheme creation; version model/additional/special rules |
| Complaint to OC in approved form | s 152; approved form s 200 | All | ABSENT | No complaint entity; `breach_notice` enum never instantiated | 🟠 | Implement s 152 approved-form complaint as grievance entry point |
| Written notice of decision NOT to take action (with reasons) | s 154 | All | ABSENT | No outcome handling; notifier has no template; SPEC §7.3 promises written reasons | 🟠 | Auto-generate s 154 written-reasons notice on declined breach decision |
| Notice to rectify breach (28-day rectification) | s 155, s 156 | All | ABSENT | Only unused `breach_notice` enum; no template/timer/non-rectification branch | 🟠 | Add breach-notice record + template + 28-day timer + status flow |
| Final notice + service methods | s 157, s 158 | All | ABSENT | No final-notice template or service-of-notice logic — notices unprovable | 🟠 | Add s 157 final notice after non-rectification; record s 158 service method/date |
| VCAT-ready dispute records | Part 11 (ss 162–166, 169I–169J) | All | ABSENT | No structured dispute record (parties, notices served, evidence, dates); task's VCAT-ready requirement unmet | 🟠 | Model dispute aggregate threading complaint → decision → notices → escalation → VCAT, exportable as evidence pack |
| Power to make own rules (permitted subject-matter) | s 138, s 138A, s 138B | All | ABSENT | No rule-making service/route | 🟡 | Model rule-making as special-resolution motion constrained to Sch 1 matters |
| Recording/consolidating rule changes (effective on registration) | s 142 | All | ABSENT | No amendment/lodgement workflow; SPEC §6.3 aspiration only | 🟡 | Generate consolidated-rules doc + lodgement task; effective only from recorded date |
| Give rules to owners; advise occupiers | s 143, s 136 | All | ABSENT | No automated rule delivery on new ownership/tenancy or rule change (SPEC §6.3 promise) | 🟡 | Subscribe to ownership/tenancy/rule events; auto-send via notifier + log |
| Decision whether to take action | s 153 | All | PARTIAL | `decisions.ts` + `breach_notice` kind could support it but nothing raises it | 🟡 | On complaint intake open a `breach_notice` committee decision |
| Report complaints/breach notices to AGM | s 159 (+ s 144/145 retention) | All | ABSENT | Free-form agenda; no aggregation; nothing to retain | 🟡 | Auto-insert s 159 agenda item; 7-year retention |
| CAV / DSCV conciliation escalation signposting | s 160, s 161 | All | ABSENT | No signposting (SPEC §7.3 promise) | 🟡 | Auto-send s 160/161 guidance on unresolved dispute; record escalation state |
| Rules of no effect if inconsistent with law | s 140 | All | ABSENT | No rules engine to validate against | ⚪ | Validation/warnings when custom rules added |
| Who is bound by rules (owners/occupiers/guests) | s 141, s 141A | All | PARTIAL | Party model exists but never linked to rules/enforcement | ⚪ | Target grievance/breach at people/tenancies; record bound-party basis |
| ACL overlay + approved forms + APP handling of complaint data | s 199, s 200; Privacy Act APPs | All | ABSENT | Whole chain unbuilt so no approved forms / APP handling of complaint data | ⚪ | Template CAV-approved forms verbatim; apply APP controls. **Confirm current form numbers with CAV** |

### 2.5 Platform Operator Posture (Good Strata Pty Ltd)
*Money-handling/trust/AFSL, OC-manager registration, Privacy (APPs), ADM transparency, ASIC.*

| Obligation | Statutory basis | Applies to | Status | Gap | Sev. | Recommendation |
|---|---|---|---|---|---|---|
| Hold OC money on trust in **separate** bank accounts per OC | s 122(2)(a),(c),(d), s 122(3)–(4) (ins. 4/2021 s 53) | Hosted money-holding | ABSENT | All Monoova PayIDs resolve to one shared platform account → **commingling across unrelated OCs**; segregation ledger-only; no s 122(3) exception applies | 🔴 | Provision genuine per-OC trust account (Monoova virtual accounts or licensed statutory trust); reconcile per-OC to bank; legal sign-off before live money |
| Paid/rewarded manager must be **registered** with BLA | s 119(2) (amended 4/2021 s 51) | Hosted manager role | ABSENT | Product acts as paid manager (takes margin) but registration is treated as conditional; appointing an unregistered paid manager is prohibited | 🟠 | Decide characterisation: register as OC manager OR position strictly as a self-management tool (no money-holding, committee remains manager). **Legal advice on tool-vs-manager line** |
| Manager PI insurance to prescribed amount | s 119(5); OC Regs r 10 (amount **unverified**) | Hosted manager role | ABSENT | No PI cover evidenced; no data model for operator's own PI policy | 🟠 | Obtain + track OC-manager PI insurance before acting as paid manager; notify BLA on lapse |
| AFSL / non-cash-payment facility authorisation | Corporations Act ss 763D, 764A(1)(ka), 911A; ASIC RG 185; Instr 2016/211 | Platform operator | UNCLEAR | Collecting levies + paying many contractors isn't single-payee and likely exceeds low-value relief; no documented AFSL or agency reliance on Monoova's AFSL | 🟠 | Financial-services lawyer to map fund flow; paper agent/AR reliance on Monoova OR obtain own authorisation; factor 2026 payments-licensing reforms |
| ADM transparency in privacy policy (from 10 Dec 2026) | Privacy Act APP 1.7–1.9 (ins. 2024 amendment) | APP entity | PARTIAL | Policy lacks prescribed ADM-transparency content ~5 months before commencement | 🟡 | Add ADM section (which decisions automated, PI used, human-review path); lean on human-decision gate |
| APP 5 collection notice at point of collection | Privacy Act APP 5 | Owners/residents | ABSENT | No collection notice/consent at invite/onboarding | 🟡 | Surface short APP 5 notice on invite/registration + bulk import; log display |
| APP 8 cross-border disclosure controls | Privacy Act APP 8, s 16C | Hosted AI/storage | PARTIAL | Hosted AI path can route PI to Anthropic (US); S3 region env-configurable not code-pinned to Sydney | 🟡 | Default to local model for prompts with PI OR put APP 8 DPA in place; pin storage to ap-southeast-2 |
| Manager commission / beneficial-relationship disclosure to chair | s 122(1)(f), s 122A, s 122B | Hosted manager role | PARTIAL | Public marketing disclosure ≠ statutory chair notice; margin not implemented in code | 🟡 | Implement written chair disclosure for any supply-contract benefit; keep margin flat + disclosed |
| No misleading/deceptive conduct | ACL (CCA Sch 2) s 18, s 29 | Marketing/site | PARTIAL | Site claims a fee-transparency mechanism (margin-as-event, pre-payment display) that **is not built** — `payments.ts` posts full amount | 🟡 | Build margin-as-audited-event + pre-payment display before claims go live, OR soften copy |
| APP 11 security + NDB scheme | Privacy Act APP 11, Part IIIC | Operator | PARTIAL | Good technical controls (hashed passwords, RBAC, append-only log) but no documented breach-response/30-day assessment playbook | 🟡 | Document NDB response plan + assessment workflow; assign breach-detection ownership |
| Separate accounting per OC + 3-year statements on request | s 122(2)(b),(d) | Hosted money-holding | PARTIAL | Strong per-OC ledgers but no real per-OC trust bank account → no bank statements to produce | 🟡 | Once per-OC trust accounts exist, expose downloadable 3-year bank statements + reconciliations |
| Manager appointment by approved-form instrument, ≤3-year term | s 119(1D), s 119(3) | Hosted manager role | ABSENT | No appointment entity/term/approved-form contract | 🟡 | Model appointment (approved form, ≤3yr, renewal rules); enforce term limits |
| APP 12/13 access & correction | Privacy Act APP 12, APP 13 | Owners/residents | PARTIAL | Partly self-service, partly manual with no tracked request handling | ⚪ | Add access/correction request workflow or documented SLA; self-service for owner-editable fields |
| Registered manager annual statement to BLA | s 183 (content **unverified**) | Registered mgr | ABSENT | Only a reminder contemplated | ⚪ | Build annual-statement workflow + BLA reminders |
| Return funds & records within 28 days on termination | Manager provisions / CAV ("28 days") — **section unverified** | Offboarded mgr | ABSENT | No offboarding/return-of-funds workflow despite "no lock-in" marketing | ⚪ | Build offboarding: remit per-OC trust balances + export records within 28 days |
| APP-entity status (small-business exemption being removed) | Privacy Act s 6C/6D | Operator | UNCLEAR | Coverage not formally analysed; some s 6D carve-outs may already apply | ⚪ | Confirm APP-entity status; continue complying; plan for exemption removal |
| TFN Rule if TFN stored | Privacy Act s 17; TFN Rule 2015 | If TFN stored | ABSENT | SPEC intends TFN capture; no `tfn` column yet | ⚪ | If added, apply TFN Rule (restricted access, encryption, minimal retention) |
| Accurate contemporaneous records of automated actions | Supports APP 1 + s 144 | All agent actions | IMPLEMENTED | Append-only `event_log` w/ actor typing + `agent_runs` transcript — a genuine strength | ⚪ | Preserve append-only guarantee via DB triggers; keep attributing tool-calls to `agent_run` |
| ASIC good standing + directors' duties + financial records | Corporations Act ss 180–184, s 286, annual review; AML/CTF Act | Good Strata Pty Ltd | UNCLEAR | Corporate administration, not assessable from code | ⚪ | Standard housekeeping; verify AML/CTF (AUSTRAC) role given third-party fund movement under 2026 tranche-2 reforms |

### 2.6 Financial Management
*OC Act 2006 Part 3 (fees & finances, ss 23–35) + maintenance plan/fund (ss 36–42), Penalty Interest Rates Act 1983, OCOAA 2021 tier reforms, OC Regs 2018; adjacent GST (A New Tax System (GST) Act 1999 / TAA 1953).*

GoodStrata has the **strongest engineering in this domain of any assessed area**: a deterministic largest-remainder levy-apportionment engine (`levy-calc.ts`) that provably sums to budget and apportions strictly by lot liability (s 23), per-lot double-entry ledgers, idempotent payment reconciliation (`payments.ts`), a fund-split-on-receipt path, and a non-compounding actual/365 penalty-interest engine (`interest.ts`) whose 10% default matches the current Penalty Interest Rates Act 1983 rate. What is missing is the **statutory finance-governance and reporting layer above the ledger**: annual fees and budgets are adopted by a single "treasurer" decision click rather than by resolution of the owners corporation in general meeting; there is **no financial-statements artefact (s 34) and no audit-or-review-of-accounts workflow (s 35) at all**, even though Tier 1 OCs must audit and Tier 2 OCs must have an independent review; special/extra fees (s 24) cannot be raised; and the fee-notice/interest/recovery chain omits statutorily required contents and authorisations. Section numbers below were checked against Consumer Affairs Victoria and secondary legal/accounting sources; the Part 3 audit/review tier application and the maintenance-plan/fund sub-numbering (post-OCOAA-2021) could not be confirmed against a current primary consolidation and are flagged **unverified**.

| Obligation | Statutory basis | Applies to | Status | Gap | Sev. | Recommendation |
|---|---|---|---|---|---|---|
| Set annual (ordinary) fees in proportion to lot liability, by resolution of the OC | s 23; s 28 | All | PARTIAL | `levy-calc.ts` apportions strictly by `lot.liability` (a strength), but `budgets.ts` routes adoption to a single `deciderRole:"treasurer"` decision; `adoptedAtMeetingId` is never populated — fees are *set* by one officer's click, not an OC resolution, so the levies may be unenforceable | 🟠 | Tie fee-setting to an adopted AGM/SGM motion; treat treasurer sign-off as preparation, not the setting resolution |
| Prepare an annual budget / estimate of fees before the AGM | s 23; s 71(2) | All | PARTIAL | `createBudget` captures only `adminCents`+`maintenanceCents`; no itemised estimate (admin/insurance/maintenance-plan contribution) and not attached to an AGM | 🟠 | Model an itemised estimate; require it as a seeded AGM agenda item and bind adoption to the meeting |
| Levy special / extra fees (75% approval where fee > 2× annual fees; benefit-principle apportionment) | s 24 | All | ABSENT | No special-fee path; no >2×-annual threshold, no 75% gate, no benefit apportionment — the OC cannot lawfully raise extraordinary funds via the platform | 🟠 | Add a s 24 special-fee type with the special-resolution/75% gate and optional benefit-based apportionment |
| Keep proper accounts and financial records | s 33 (**sub-no. unverified**); s 144 | All | IMPLEMENTED | Per-scheme ledgers (`funds`, `fundTransactions`, signed `lotLedgerEntries`, `payments`/`receipts`) on an append-only event spine — a genuine strength | ⚪ | Preserve; expose via the Part 9 inspection flow (2.3); reconcile fund-balance cache to `fundTransactions` |
| Prepare annual financial statements | s 34 (**numbering unverified**) | All | ABSENT | No statements service/generator; the `financial_statements` compliance kind is dead schema | 🟠 | Build a statements generator off the ledgers; raise a `financial_statements` obligation each FY-end; seed onto the AGM notice pack |
| Audit (Tier 1) or independent review (Tier 2) of financial statements | s 35 + OCOAA 2021 tiers (**mapping unverified**) | T1 audit; T2 review (both mand.); T3–T5 optional | ABSENT | No audit/review concept — no practitioner record, report artefact, "table at GM" step, or s 35(8) independence check; applicability rides the **defective `schemeTier()`** | 🟠 | Fix `schemeTier()` on occupiable lots; add a tier-keyed audit/review workflow capturing practitioner + independence + report as an inspectable record, tabled at the AGM |
| Fund the maintenance plan through the budget for prescribed higher-tier OCs | ss 36–39 (**sub-numbering unverified**) | T1/T2 mand.; T3–T5 opt. | PARTIAL | Budget always emits a `maintenance` line but it is a free number, **not derived from an approved s 36/37 plan** | 🟡 | Once the s 37 plan exists (2.2), derive the annual contribution from it and require it in the T1/T2 budget |
| Establish maintenance fund; control payments (extraordinary payments need special resolution) | ss 40–42 (**sub-numbering unverified**) | OC with plan / prescribed | PARTIAL | Admin+maintenance funds seeded per scheme, but the fund is not tied to a plan and **s 42 payment controls are unenforced** | 🟡 | Link the fund to the plan; enforce maintenance-fund outflows are plan-listed or special-resolution-approved |
| Fee notice: ≥28 days to pay, prescribed contents; final fee notice before recovery | s 31; s 32 | All | PARTIAL | `issueLevyRun` never validates the due date is ≥28 days after issue; omits penalty-interest terms + dispute-availability statement; the day-30 "final_notice" is a reminder, not the s 32 instrument | 🟠 | Enforce a 28-day floor; add prescribed contents; model a distinct s 32 final fee notice as the recovery gate |
| Penalty interest capped at the statutory rate and only if authorised by GM resolution | s 29 (**sub-no. unverified**); Penalty Interest Rates Act 1983 | All | PARTIAL | `interest.ts` correct in form + 10% default, but the per-scheme rate has **no statutory cap**, interest is applied **with no GM-authorisation check**, and accrued interest is **never posted to `lotLedgerEntries`**, so demanded totals diverge from balances | 🟡 | Cap at the current statutory rate; require a recorded GM authorisation; post accrued interest as an `interest` ledger charge |
| Recover unpaid fees as a debt; recovery costs limited to proportional actual cost | s 30; CAV cost limit | All | PARTIAL | `recovery.ts` gates a demand behind a day-60 committee decision (good) but posts no capped recovery-cost charge, has no s 32 pre-recovery gate, and no VCAT/court debt artefact | 🟡 | Add a capped itemised recovery-cost posting; require the s 32 notice first; produce a VCAT-ready debt pack |
| Lodge BAS / account for GST if registered | GST Act 1999; TAA 1953 | GST-registered OCs | ABSENT | `gstRegistered` + `bas` kind + GST helpers exist, but levies compute no GST and there is no BAS obligation/reminder — dead schema | ⚪ | If serving GST-registered OCs, compute GST on applicable fees and raise recurring `bas` obligations |

**Domain gap counts:** 0 blocker · 6 high · 4 medium · 2 low. *Cross-refs: the `schemeTier()` defect (2.1/2.2/§4) drives audit-vs-review applicability here; the maintenance-plan artefact is scored in 2.2, so this section scopes only funding/controls.*

---

## 3. Consolidated Prioritized Backlog (Blocker + High)

Ordered as an engineering/product backlog — build these to make GoodStrata statutorily sound. **All 3 blockers + 35 highs.**

### 🔴 P0 — Blockers (do not onboard paying schemes / take live money until fixed)

| # | Build | Domain | Basis |
|---|---|---|---|
| P0-1 | **Per-OC trust bank accounts** (Monoova virtual accounts or licensed statutory trust); stop pooling multiple OCs' funds; reconcile per-OC to bank | Platform | s 122(2)(c) |
| P0-2 | **One-vote-per-lot tally for ordinary resolutions** (majority of votes cast) + poll-on-demand re-tally on entitlement | Meetings | s 91, s 92 |
| P0-3 | **Grievance / dispute module** (approved-form complaint, 28-day meet-and-discuss clock, breach-notice chain, rights notices) | Rules & Disputes | Model Rule 7, ss 152–159 |

### 🟠 P1 — High (statutory correctness / core artefacts)

**Financial & money-handling posture**
- P1-1 **OC-manager registration decision + BLA registration** (or re-characterise strictly as a self-management tool). — s 119(2)
- P1-2 **Manager PI insurance** cover + tracking. — s 119(5)
- P1-3 **AFSL / NCP facility** resolution (document Monoova AR/agency reliance or obtain authorisation). — Corps Act ss 763D/911A

**Financial governance (Part 3) — the ledger is strong; the statutory layer above it is missing**
- P1-29 **Bind fee/budget adoption to a general-meeting resolution** (populate `budgets.adoptedAtMeetingId`); treasurer sign-off = preparation, not the setting resolution — else levies may be unenforceable. — s 23
- P1-30 **Annual financial statements generator** off the ledgers + a `financial_statements` obligation each FY-end, seeded onto the AGM notice pack. — s 34
- P1-31 **Audit (T1) / independent review (T2) of accounts** workflow keyed to the corrected tier, capturing practitioner + independence + report as an inspectable record tabled at the AGM. — s 35
- P1-32 **Special/extra fees (s 24)** levy type with the >2×-annual-fees → 75%/special-resolution gate and optional benefit-principle apportionment.
- P1-33 **Penalty-interest correctness:** cap the per-scheme rate at the statutory maximum, require a recorded GM authorisation, and **post accrued interest to the ledger** so demanded totals reconcile to balances. — s 29
- P1-34 **s 32 final fee notice** as the recovery gate + 28-day due-date floor + prescribed notice contents; capped recovery-cost posting. — ss 31/32/30

**Compliance calendar & insurance (shared engine unblocks several)**
- P1-4 **Compliance service + calendar** generating/aging `complianceObligations`; wire `notifier.ts` for 90/60/30-day escalation. — SPEC §6.4 (enables P1-5..P1-8, P1-10)
- P1-5 **Insurance service** persisting `insurancePolicies`; require current building (reinstatement) policy before activation + ongoing expiry monitor. — s 59
- P1-6 **Public-liability policy capture + $20M minimum** enforcement. — s 60(3)
- P1-7 **Valuation tracking** (5-year cycle, sum-insured>value renewal test, table report at GM). — s 65
- P1-8 **ESM scheduling + Annual ESM Report** tracking (life-safety). — Building Regs 2018 Part 15
- P1-9 **Maintenance plan (s 37 10-year capital-items)** model + approval workflow, OR restrict onboarding to T3–5 and document T1/T2 unsupported. — ss 36–39

**Records / register / certificate (Part 9)**
- P1-10 **OC certificate (s 151) generator** — 13 content items + attachments (rules, Sch 3 statement, last-AGM resolutions), 10-business-day SLA. *(Top records priority.)*
- P1-11 **OC register (s 147/148)** construct rebuilt from data spine + event updates.
- P1-12 **Manager registration number field** on `organizations`, feeding register + certificate. — s 148(c)
- P1-13 **Records retention engine** (12mo ballots/proxies; 7yr others) + disposal sweep. — s 145
- P1-14 **Records inspection flow** admitting owner/mortgagee/purchaser/representative; never hide a s 144 record from an owner. — s 146
- P1-15 **s 144 record-coverage model** + capture owner postal address on import. — s 144

**Meetings governance**
- P1-16 **Statutory notice-pack assembly** (financials, budget, resolution text, reports, previous minutes). — ss 72/76
- P1-17 **15-month AGM-due monitoring** (`agm_due` obligation). — s 69
- P1-18 **Deterministic s 81(2) minutes** (attendance + proxy names templated from data, LLM narrative only). — s 81
- P1-19 **Committee election workflow + s 103 constraints** for 13+ lot schemes (arrears eligibility/suspension). — ss 100/103
- P1-20 **Proxy vote caps** (1 lot ≤20 / 5% >20 + family exception). — OCOAA 2021 *(confirm section)*
- P1-21 **AGM mandatory agenda items** (s 71(2)) required before notice issues.
- P1-22 **Interim-resolution machinery** (no-quorum + s 97 special) with 14/29-day + petition path. — ss 78/97

**Rules & disputes (beyond P0-3)**
- P1-23 **Model-rules engine** (`scheme_rules` seeded with Sch 2). — s 139
- P1-24 **s 152 approved-form complaint intake.**
- P1-25 **s 154 written notice of decision not to act.**
- P1-26 **s 155/156 notice to rectify** + 28-day timer.
- P1-27 **s 157/158 final notice** + service-method recording.
- P1-28 **VCAT-ready dispute aggregate** (exportable evidence pack). — Part 11

> P1 items P1-4 through P1-8 and P1-10 through P1-14 all depend on, or are dramatically accelerated by, the **compliance service / calendar (P1-4)** and a thin **insurance/register service layer** over already-existing dead schema. Prioritise those enablers.

---

## 4. Tier Applicability Matrix

CAV tiers (by **occupiable** lots): **T1** >100 · **T2** 51–100 · **T3** 10–50 · **T4** 3–9 · **T5** 2-lot subdivision / services-only.

| Obligation area | T1 | T2 | T3 | T4 | T5 | Notes |
|---|:--:|:--:|:--:|:--:|:--:|---|
| Meetings, resolutions, minutes, quorum, proxies (Part 4) | ✔ | ✔ | ✔ | ✔ | ✔ | Not tier-gated |
| Must elect a **committee at each AGM** | ✔ | ✔ | ✔¹ | ✔¹ | — | **Mandatory at 13+ lots** (s 100(1)); optional below. Keyed to lot count, **not** tier |
| Rules (Part 8) + grievance/dispute (Parts 10–11) | ✔ | ✔ | ✔ | ✔ | ✔ | Apply to **all** tiers incl. 2-lot |
| Records / register / certificate (Part 9) | ✔ | ✔ | ✔ | ✔ | ✔ | Not tier-gated |
| Building reinstatement + PL insurance (ss 59/60) | ✔ | ✔ | ✔ | ✔ | ✖² | ²T5 (2-lot/services-only) exemptions may apply |
| 5-yearly valuation (s 65) | ✔ | ✔ | ✔ | ✔ | ✖² | |
| **10-year maintenance plan** (s 36) | **Mand.** | **Mand.** | Opt. | Opt. | Opt. | GoodStrata cannot currently produce a compliant plan → acute if T1/T2 onboarded |
| ESM maintenance + Annual ESM Report | ✔³ | ✔³ | ✔³ | ✔³ | ⚠³ | ³Depends on whether common property includes prescribed ESMs (Class 2 buildings), not tier per se |
| **Audit / review of accounts by tier** (financial) | Audit | Review | Opt.⁴ | Opt.⁴ | Opt.⁴ | s 35: **T1 must audit**, **T2 must have an independent review**; T3–T5 by resolution. Absent in code (§2.6) |

¹ Mandatory only where the OC has **13 or more lots** — a T3 scheme may be 10–12 lots (optional) or 13+ (mandatory). ⚠ The 13-lot threshold conflicts with some CAV pages citing 10; treat s 100(1) "13" as authoritative and confirm with counsel.
⁴ T3–T5 may resolve to have an audit or independent review; not mandatory. The audit-vs-review tier mapping (s 35) needs primary-source confirmation (§5).

**Codebase classifier defect:** `schemeTier()` uses raw (not occupiable) lot counts, is off-by-one at 10 lots (10→T4 instead of T3), and never classifies services-only schemes as T5 (s 8). Fix and add boundary unit tests at 2, 3, 9, 10, 50, 51, 100, 101.

---

## 5. Could-Not-Verify / Needs Legal Confirmation

These items rely on sources that could not be confirmed against a current primary consolidation. **An Australian lawyer must verify each before reliance.**

1. **OCOAA 2021 renumbering generally** — proxy vote caps, the 13-lot committee threshold, and the 5-tier occupiable-lot band section numbers were not verified from a post-2021 primary consolidation. The **proxy-cap section** is inferred (likely a new s 89A / amended s 87) and is unconfirmed.
2. **Proxy vote caps + family/prescribed exceptions** — the exact cap section and OC Regs 2018 exceptions.
3. **Building Regulations 2018 (Vic) Part 15 ESM regulation numbers** (commonly cited reg 223) and the Annual ESM Report obligation — confirm with a registered building surveyor / lawyer.
4. **OC Regulations 2018 sub-numbering** for certificate contents/fees/GST (rr 12–17), additional records (r 11A), PI amount (r 10), and prescribed **forms** (proxy form, complaint form, notice-to-rectify/final-notice forms, Sch 3 statement) — the instrument has been amended repeatedly.
5. **Developer initial-records handover section** (~s 143/143A) — section number unverified.
6. **Registered-manager annual statement (s 183)** content and **28-day return-of-funds-on-termination** section — unverified.
7. **Arrears voting bar citation** — the report treats **s 94** as the arrears bar and **s 89** as the anti-coercion provision (the code/SPEC mis-cite s 89); confirm current numbering.
8. **13 vs 10 lot committee threshold** — CAV pages conflict; s 100(1) "13" treated as authoritative pending confirmation.
9. **AFSL vs Monoova AR reliance**, **AML/CTF (AUSTRAC) role**, and **APP-entity status** (s 6D small-business exemption and its removal timing) — all require specialist financial-services/privacy advice.
10. **Meetings source consolidation** — meetings section numbers were verified against an ~2011-consolidated authorised text cross-checked with CAV, not a current post-2021 consolidation.
11. **Financial Part 3 sub-numbering (post-OCOAA-2021)** — the exact sections for keeping accounts (s 33), financial statements (s 34), and the maintenance plan/fund cluster (ss 36–42), and the **tier-to-section mapping for audit vs review (s 35)**, could not be confirmed against a current primary consolidation (§2.6 tier bands + T1-audit/T2-review were confirmed via Consumer Affairs Victoria).

---

## 6. Top 5 Things to Build First

1. **Per-OC trust bank accounts** (end commingling) — OC Act s 122. *Blocker; gates any live money.*
2. **One-vote-per-lot ordinary-resolution tally** (with poll-on-demand) — s 91/92. *Blocker; current tallies can be legally wrong.*
3. **Grievance / dispute module** (complaint intake, 28-day clock, breach-notice chain, VCAT-ready records) — Model Rule 7 / ss 152–159. *Blocker; entirely absent.*
4. **Compliance service + calendar** (wire the dead `complianceObligations` schema + notifier) — unblocks insurance-renewal, $20M PL, 5-year valuation, ESM, AGM-due, and certificate-deadline reminders in one stroke — ss 59/60/65/69 + Building Regs.
5. **OC certificate (s 151) generator + OC register (s 147/148)** (incl. manager registration number field) — required for every lot sale's vendor statement and the foundational Part 9 artefacts.

---

*Prepared as a product/engineering compliance-gap assessment. Not legal advice. Review by an Australian lawyer required before reliance.*

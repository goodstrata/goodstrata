# Victorian legislative functionality sweep — implementation close-out

> Product and engineering assessment for counsel review. Not legal advice.

Date: 13 July 2026

Primary rule set used for this pass:

- Owners Corporations Act 2006 (Vic), authorised version 023:
  <https://www.legislation.vic.gov.au/in-force/acts/owners-corporations-act-2006/023>
- Owners Corporations Regulations 2018 (Vic), version 002:
  <https://www.legislation.vic.gov.au/in-force/statutory-rules/owners-corporations-regulations-2018/002>

This document records the state of the code after the July 2026 end-to-end
remediation pass. It supersedes implementation-status statements in
`COMPLIANCE-GAPS.md` and the 5 July snapshot in `legal/statute-map.md`; those
documents remain useful as the original issue inventory and primary-source
research.

## Delivered in this pass

| Domain | Legislative requirement addressed | Product implementation |
|---|---|---|
| Jurisdiction | Rules must not silently apply outside their jurisdiction | Scheme creation now fails closed for every state except Victoria. |
| Annual budgets and fees | Owners adopt budgets/fees; fee notices allow the statutory payment period | Budget adoption requires a finally carried ordinary AGM/SGM motion. Committee approval only tables a proposal. Fee notices enforce a 28-day floor. |
| Special fees | Resolution threshold and allocation basis | Special fees require a carried resolution; amounts over twice annual fees require a special resolution. The schedule records fund, purpose and liability/benefit allocations. |
| Interest and recovery | Interest must be authorised and capped; final notice precedes recovery | Effective-dated carried-motion authority is required, with a 10% p.a. ceiling. Notices snapshot the authority. Approved final fee notices include service evidence and a further 28-day recovery standstill. Recovery fails closed until that gate matures. |
| Annual accounts | Financial statements and tier review/audit evidence | Ledger-derived annual statements, seven-year retained PDFs, Tier 1 audit/Tier 2 review evidence, AGM presentation and compliance completion workflows. |
| OC register | Maintain prescribed particulars and make the register available | Register projection now covers the scheme, lots/current owners, liability/entitlement basis, manager, insurance, rules amendments, contracts, leases and licences. |
| OC certificates | Written request, fee cap, deadline, prescribed information and attachments | Standard/priority/urgent requests, versioned 2026–27 fee ceilings, business-day deadlines, immutable issue snapshots, rules/advice/AGM attachments, authoriser/seal evidence and retained certificate copy. |
| Inspection | Owners and other eligible requesters can inspect; commercial-purpose consent and copy caps apply | Owner, mortgagee, buyer and representative request flow with eligibility verification, commercial-consent evidence, scheduling, completion and capped copy fees. |
| Retention | Votes/proxies and general OC records have different minimum periods | Operational, 12-month, seven-year and permanent classes; deletion holds; automated disposal after eligible periods; votes/proxies carry 12-month retention dates. |
| Building insurance | Reinstatement/replacement and applicable public-liability cover | Structured policies, evidence documents, claims, $20m public-liability floor, applicability/exemption facts and activation readiness. |
| Valuation | Periodic building replacement valuation | Structured valuations with five-year next-due date and meeting evidence. |
| Maintenance plan | Ten-year capital plan, approval and maintenance fund relationship | Asset register, ten-year statutory plans, condition/action/cost/life fields, fund linkage, carried-resolution approval, reviews and AGM funding-gap reporting. |
| Registered manager | Registration, PI, appointment term/form/delegations and changes | BLA checks, $2m PI evidence/continuity, three-year term (five for retirement villages), approved-form metadata/document, appointment and delegation resolutions, activation/termination, owner notices and 28-day records-return deadline. |
| Meeting chair | A human chairs a general meeting; an eligible owner-chair may break a tie | General meetings cannot close and AGM video cannot start without a recorded human owner/manager chair. AI is explicitly assistance-only. An authenticated owner-chair can exercise the casting vote on an equal ordinary vote. |
| Committee | Committee election at AGM and statutory size | Issued-AGM election record, owner eligibility, 3–7 default size and 8–12 only with a finally carried expansion motion. The outgoing committee is end-dated, not deleted. |
| Written authority | Powers of attorney affect attendance, quorum and voting | Retained signed instrument, start/end/revocation, owner/attorney-scoped visibility, quorum and voting standing, and web/native revoke workflows. |
| Defensive API behaviour | Invalid legal-record identifiers must not become server errors | Meeting, motion, agenda and authority path UUIDs are validated before database access. |

The new officer workflows are available in both web and native clients. The
combined schema change is `packages/db/migrations/0017_nostalgic_kabuki.sql`.

## Existing functionality retained and re-verified

- One vote per lot for ordinary resolutions, entitlement poll before or after
  the vote, current s 89B cleared-funds/arrears rules, interim resolutions,
  proxy lapse/caps and manager-motion restrictions.
- Fourteen-day general-meeting notices, quorum, attendance, minutes and
  owner-submitted agenda items.
- Approved grievance procedure with 28-day clock, rectify/final notices, VCAT
  state and the de-identified s 159 AGM report.
- Per-scheme trust ledger/account provisioning, reconciliation, receipting and
  append-only actor-attributed audit events.

## Residual items that code alone cannot close

These are not represented as “compliant” in product copy until the stated
evidence or decision exists.

1. **Manager/platform legal characterisation.** Counsel must decide when Good
   Strata itself is carrying out manager functions for fee or reward. An
   appointment lifecycle now exists, but the normal onboarding flow does not
   provision/assign a management organisation and the BLA check is evidence
   capture, not a live authoritative register integration.
2. **Trust-account legal opinion.** Per-OC Monoova virtual accounts and ledgers
   are segregated, but counsel/provider evidence must establish whether an
   mAccount is a “separate bank account” for s 122. Production also needs an
   on-demand bank-statement evidence workflow for the three-year request right
   and an explicit treatment of interest earned on trust money.
3. **Approved form fidelity.** Manager appointments, certificate packages and
   other artefacts retain form version/document evidence, but the repository
   does not certify bundled CAV Word templates. Proxy appointment is still an
   authenticated electronic record with an optional document field; counsel
   should confirm the electronic-signature/prescribed Schedule 1 approach or
   require a retained signed upload before appointment.
4. **Voting-paper signature.** Authentication, actor, lot, motion text, choice
   and timestamp are retained. Counsel should confirm whether this is a valid
   electronic signature for regulation 7B or specify an additional signature
   ceremony/artefact.
5. **Insurance fact classification.** `hasCommonProperty`, multi-storey and the
   exemption basis are explicit inputs, but must be verified against the plan
   of subdivision. Tier 5 is not a perfect proxy for a two-lot/no-common-
   property exemption. The exact prescribed class for mandatory five-year
   valuations also needs confirmation.
6. **Committee eligibility exceptions.** The service deliberately accepts only
   linked current owner users. Corporate nominees, proxies, co-owner/one-per-lot
   interactions, arrears suspension and casual vacancies need a counsel-approved
   authority model before they are broadened.
7. **External access channel.** Buyers, mortgagees and representatives can be
   recorded and fulfilled by authenticated staff; there is no unauthenticated
   public evidence-upload/download portal.
8. **Calendar and form currency.** Fee caps, public holidays and the 10%
   interest ceiling are versioned in code but need an owner and update process.
   Melbourne Cup substitutions vary by regional council.
9. **Privacy and data breach operations.** Statutory document disposal now has
   enforcement, but the broader APP/NDB program remains organisational work:
   offshore processor contracts/notices, APP 5 notices for people entered by
   an OC, read-access/security logging, data-subject export/correction routing,
   and a tested breach-response plan.
10. **AFS licensing boundary.** Insurance administration records governance;
    it does not authorise Good Strata or an appointed manager to provide a
    financial service or act without any required AFS licence/authorisation.

## Verification at close-out

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- Targeted Playwright coverage for the changed statutory workflows, followed
  by the complete browser suite.

The final command outcomes are recorded in the implementation handoff for this
change set.

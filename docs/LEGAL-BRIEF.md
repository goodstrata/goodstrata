# GoodStrata — Legal Engagement Brief (go-live)

Prepared 2026-07-05 for Good Strata Pty Ltd (ACN 684 135 760 · ABN 55 684 135 760).
Companion to `COMPLIANCE-GAPS.md` (2026-07-03 product/engineering audit — attach both when engaging counsel).

**Purpose:** brief one or two Australian lawyers to clear GoodStrata for public launch.
This document is a set of questions for counsel, not legal advice.

## Status corrections to the 2026-07-03 audit

Verified against the codebase 2026-07-05:

- ~~Blocker 2 — ordinary resolutions tallied by entitlement~~ **FIXED**: `tallyMotion` now
  decides ordinary resolutions one-vote-per-lot (headcount), entitlement only on a
  demanded poll (s 91 / s 92(3)–(5)); s 94 arrears exclusion implemented.
- ~~Blocker 3 — grievance machinery absent~~ **SUBSTANTIALLY BUILT**: approved-form
  complaint intake with explicit-complainant support, 28-day meet-by clock, breach
  notices, complaint events; compliance calendar service + daily sweep cron now live.
  Counsel to verify statutory completeness (s 152–159, Model Rule 7, s 159 AGM report).
- Blocker 1 — **trust-money separation stands** and is the top payments question below.
  Mitigation: payments remain sandbox-only; no live money moves through the platform today.

## Who to engage

1. **Victorian strata / OC specialist** (characterisation, s 119/122, meetings validity).
   Finding one: LIV referral service, or SCA (Vic) associate-member law firms.
2. **TMT / privacy / financial-services regulatory** (APPs, AFSL perimeter, ACL, AI).
   One mid-size firm may cover both; keep the strata specialist regardless.

## Questions for counsel, by priority

### A. Business characterisation (existential — answer first)
1. Is hosted GoodStrata (software + AI agents used by a self-managing OC) an "owners
   corporation manager" under OC Act 2006 (Vic) s 119 — triggering BLA registration,
   PI insurance (s 119(5)) and trust accounting (s 122) — or a tool the OC self-manages
   with? What product/ToS language keeps it firmly the latter?
2. The AI "chair" conducts/records meetings. Under the Act, must the chairperson be a
   natural person present? Is the correct model "human chair of record, AI assists"?
   What minute/notice wording makes AI-assisted meetings valid?
3. If a future paid tier adds services (e.g. we send notices on the OC's behalf), where
   is the line that flips us into manager territory?

### B. Trust money & payments (before Monoova goes live)
4. s 122(2)(c): does a Monoova structure with a **segregated account / unique
   BSB+account per OC** (e.g. Automatcher-style subaccounts) satisfy "separate bank
   account per OC", given funds never touch Good Strata Pty Ltd? What contractual and
   disclosure artefacts are needed?
5. Review the "GoodStrata is not a bank / does not hold funds" ToS clause (drafted, unreviewed).
6. AFSL perimeter: facilitating levy payments via a licensed provider (Monoova holds the
   AFSL/ADI relationships) — do we need our own AFSL or authorised-rep status for any of:
   payment initiation UX, arrears chasing, displaying insurance policies, the fee-estimator?
   (We do NOT advise on or arrange insurance; the audit's APP/insurance items assume display-only.)

### C. Privacy & data
7. Privacy Act application (turnover < $3M but we hold strata rolls incl. names/contacts/
   levy positions of third parties). Our published policy opts into APP compliance —
   confirm posture and NDB-scheme readiness (we have an append-only audit log).
8. APP 8 cross-border: hosted-AI prompts can route to Anthropic (US); compute runs on
   Cloudflare's network (container placement not region-pinned); Postgres + S3 pinned
   ap-southeast-2. Is the signup claim **"Your data stays in Australia"** sustainable, or
   must it be qualified ("stored in Australia")? What DPA/contractual controls are needed?
9. Data retention: statutory OC record-keeping periods vs deletion rights; our
   `retentionUntil` scaffolding — what schedule should it enforce?

### D. Consumer law & marketing
10. ACL s 18 review of marketing claims: "The building runs itself", fee-comparison tool
    ("what your manager charges"), "free forever", "every dollar on the record".
11. Free service still attracts ACL consumer guarantees — review warranty/liability
    clauses in ToS for non-excludable guarantee conflicts.
12. The public complaint-intake and breach-notice templates: any unauthorised-legal-
    practice or misleading-document risk in AI-drafted statutory notices?

### E. Company & IP hygiene
13. PI + cyber insurance for Good Strata Pty Ltd itself (current PI sits with Noice Pty Ltd —
    confirm it does not extend; quote standalone cover).
14. Trademark: "GoodStrata" word mark (AU class 9/42); Apache-2.0 licence + trademark
    coexistence; contributor licensing for the open-source repo.
15. Anything triggered by giving the software away free while operating hosted infra
    (gratuitous service, GST treatment when paid tiers arrive).

## What to hand counsel

- This brief + `COMPLIANCE-GAPS.md`
- Live ToS + Privacy pages (goodstrata.com.au/terms, /privacy)
- The marketing site (claims inventory: home, how-we-make-money, what-am-i-paying)
- Monoova integration design note (payments driver, packages/integrations/src/payments.ts)
- A demo login so counsel can see the meeting/complaint/levy flows first-hand

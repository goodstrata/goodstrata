# GoodStrata Feature Specification
## Fully Autonomous OC Management Platform

**Version:** 0.1 Draft
**Date:** April 2026
**Author:** Noice Pty Ltd

---

## Design Philosophy

GoodStrata replaces the human strata manager entirely for small-to-medium OCs (Tier 2-5, typically 2-50 lots). Every function that a registered Owners Corporation Manager performs under the Owners Corporations Act 2006 (Vic) is handled by the platform autonomously, with human interaction limited to **decisioning only** -- committee members and lot owners approve, vote, or escalate. The system never blocks on a human for execution.

The model follows AgentDesk's pattern: agents execute, humans decide, everything is logged on the event bus.

---

## Architecture Assumptions (Already Built)

- Event bus with full audit trail (all actions logged and tracked)
- Multi-org, multi-tenant, multi-OC data isolation
- SMS/email notification system
- Role-based access (lot owner, committee member, chairperson, secretary, treasurer)
- Amenities management module
- Monoova NPP/PayID payment processing integration
- Agent-based task execution (AgentDesk pattern)

---

## 1. Onboarding and OC Setup

### 1.1 OC Registration Wizard
- **Guided setup flow:** OC name, plan of subdivision number, address, tier classification (auto-calculated from lot count)
- **Lot import:** Bulk import lots from plan of subdivision data (lot number, entitlement, liability weighting)
- **Owner registration:** Invite lot owners via email/SMS with secure verification; capture contact details, mailing address, and correspondence preferences
- **Committee formation:** Assign initial committee roles (chair, secretary, treasurer) or flag that these will be elected at first AGM
- **Rule set selection:** Apply model rules (Schedule 2, OC Regulations 2018) by default; allow upload of custom registered rules
- **ABN/TFN capture:** Record OC's ABN and TFN for tax and BAS obligations
- **Insurance prompt:** Require upload of current insurance certificate of currency (reinstatement/replacement + public liability) before platform marks OC as "active"

### 1.2 Bank Account Linking
- **Monoova virtual account creation:** Auto-provision a dedicated virtual account (or PayID) per OC for levy receipts
- **Outbound payment account:** Link OC's operating bank account for contractor/supplier payments
- **Trust accounting segregation:** Ensure all funds are held and reported separately per OC at the data layer

### 1.3 Data Migration
- **Import from spreadsheets:** CSV/Excel import for existing levy records, owner details, meeting minutes
- **Document upload:** Bulk upload of historical documents (insurance policies, meeting minutes, contractor agreements, plans)

**Automation level:** Fully automated except committee role assignment (requires human confirmation) and insurance upload (requires human to provide document).

---

## 2. Financial Management

### 2.1 Budgeting
- **Annual budget drafting:** System generates a draft budget based on prior year actuals, known recurring costs (insurance premium, maintenance contracts), and inflation adjustment
- **Budget categories:** Administration fund and maintenance/sinking fund (capital works), split per OC Act requirements
- **Committee review workflow:** Draft budget presented to committee for approval via in-app voting before AGM
- **AGM budget resolution:** Budget automatically included as agenda item at AGM; approved budget becomes the active budget
- **Budget vs actuals tracking:** Real-time dashboard showing spend against budget per category

### 2.2 Levy Management
- **Levy calculation:** Auto-calculate each lot's levy based on approved budget and lot liability ratios from plan of subdivision
- **Levy schedule:** Configure quarterly, half-yearly, or annual levy periods
- **Levy notice generation:** Auto-generate and distribute levy notices via email (with PDF attachment) and/or SMS at configured intervals (minimum 30 days before due date per Act)
- **PayID per invoice:** Monoova generates unique PayID per levy notice for automated reconciliation
- **Payment matching:** Incoming NPP payments auto-matched to outstanding levy invoices via PayID reference
- **Receipt generation:** Auto-generate and send receipts on payment confirmation
- **Payment plans:** Allow committee to approve instalment arrangements for hardship cases (human decision, system executes the schedule)

### 2.3 Arrears and Debt Recovery
- **Overdue detection:** Automated flagging when levy remains unpaid past due date
- **Escalation workflow (fully automated notifications, human decision to escalate):**
  1. **Day 1 overdue:** Friendly reminder (SMS + email)
  2. **Day 14 overdue:** Formal reminder with interest notice
  3. **Day 30 overdue:** Final notice with warning of penalty interest
  4. **Day 60 overdue:** Committee notified with recommendation to commence recovery; committee approves/declines via vote
  5. **Day 90+ overdue:** If approved, system generates formal demand letter (template) and optionally refers to integrated debt recovery partner API
- **Interest calculation:** Auto-calculate penalty interest at the rate resolved by the OC (or default statutory rate), applied daily, added to lot statement
- **Voting restriction enforcement:** Automatically flag lot owners with outstanding levies as ineligible to vote on ordinary resolutions per s 94 of the Act

### 2.4 Accounts Payable
- **Invoice capture:** Contractors/suppliers submit invoices via email (parsed by AI) or upload portal
- **Invoice matching:** Match invoices against approved work orders / purchase orders
- **Approval workflow:** Invoices auto-approved if within pre-approved work order amount; over-threshold invoices routed to committee/treasurer for approval
- **Payment execution:** Approved invoices paid via Monoova outbound payment on next payment run (configurable: weekly, fortnightly)
- **Supplier management:** Maintain supplier directory with ABN, bank details, insurance certificates, licence details

### 2.5 Financial Reporting and Compliance
- **Automated financial statements:** Generate income, expenditure, assets, and liabilities statements per OC Act s 144
- **BAS preparation:** Auto-calculate GST obligations and generate draft BAS for lodgement (if OC is GST-registered)
- **Annual financial report:** Auto-generate annual financial report for AGM distribution
- **Audit support:** Export complete transaction ledger with supporting documents for external auditor
- **ATO lodgement reminders:** Automated reminders for TFN, ABN, and tax return obligations

**Automation level:** Fully automated except budget approval (committee vote), debt recovery escalation past Day 60 (committee decision), and over-threshold invoice approval (treasurer/committee decision).

---

## 3. Meetings and Governance

### 3.1 Annual General Meeting (AGM)
- **Compliance monitoring:** Track date of last AGM; auto-alert committee when next AGM must be held (no more than 15 months apart per s 69)
- **Agenda generation:** Auto-generate standard AGM agenda per Act requirements:
  - Financial statements
  - Budget approval and levy setting
  - Election of committee (mandatory if 10+ lots)
  - Election of chair and secretary
  - Appointment of manager (GoodStrata, if registered)
  - Insurance review
  - Any motions submitted by lot owners
- **Notice distribution:** Auto-send AGM notice to all lot owners at least 14 days before meeting date, including agenda, proxy form, and financial statements
- **Proxy management:** Digital proxy submission; lot owners can appoint proxy via in-app form or by uploading signed proxy form; system validates proxy eligibility (family member restriction per Act)
- **Online/hybrid meeting support:** Built-in video conferencing integration or dial-in; screen sharing for financial reports
- **Quorum tracking:** Real-time quorum calculation based on attendees + valid proxies; alert if quorum not met
- **Voting engine:** Support ordinary resolutions, special resolutions (75%), and unanimous resolutions with real-time vote tallying weighted by lot entitlement
- **Minutes generation:** AI-generated draft minutes from meeting transcript/notes; distributed to all owners post-meeting
- **Resolution register:** All resolutions recorded with vote counts, date, and linked to event bus

### 3.2 Special General Meetings
- **Requisition handling:** If lot owners holding 25%+ of entitlements requisition a meeting, system auto-validates requisition and triggers meeting workflow
- **Emergency meeting support:** Shortened notice period workflow for urgent matters

### 3.3 Committee Meetings
- **Scheduling:** Committee can schedule ad-hoc meetings; system sends calendar invites
- **Agenda and minutes:** Same automated workflow as AGM but simplified
- **Delegated authority tracking:** Record what functions are delegated to committee vs require general meeting resolution

### 3.4 Ballot and Voting (Outside Meetings)
- **Circular/written resolutions:** Support for out-of-session voting via digital ballot for matters that don't require a meeting
- **Voting eligibility enforcement:** Auto-exclude lot owners with unpaid levies from ordinary resolution votes
- **Vote tallying:** Weighted by lot entitlement; results auto-published to all owners

**Automation level:** Meeting scheduling, notice distribution, proxy validation, quorum tracking, vote tallying, and minutes drafting are fully automated. Agenda items requiring motions need human submission. Voting is inherently human decisioning.

---

## 4. Maintenance and Works Management

### 4.1 Maintenance Requests
- **Submission channels:** Lot owners/residents submit requests via app, email, or SMS
- **AI triage:** Auto-categorise requests (plumbing, electrical, cleaning, structural, common area, lot-specific) and assess urgency
- **Common property validation:** System checks whether the request relates to common property (OC responsibility) or lot property (owner responsibility) and responds accordingly
- **Photo/video upload:** Attach evidence to request

### 4.2 Work Order Management
- **Auto-assignment:** Match maintenance request to appropriate contractor from approved contractor pool based on category, availability, and past performance
- **Quote workflow:**
  - Under threshold (e.g. $500): Auto-approve and dispatch to contractor
  - $500-$2,000: Route to committee for approval (single approver or majority)
  - Over $2,000: Require multiple quotes; present to committee with comparison
  - Emergency works: Auto-approve with post-hoc committee notification
- **Contractor dispatch:** Send work order to contractor via email/SMS with property access details, scope of work, and approved amount
- **Progress tracking:** Contractor updates status (accepted, scheduled, in progress, completed); lot owner notified at each stage
- **Completion verification:** Request photo evidence of completed work; route to requestor for confirmation
- **Invoice linkage:** Completed work order linked to contractor invoice for payment

### 4.3 Planned/Preventive Maintenance
- **Maintenance schedule:** Configurable recurring maintenance calendar (e.g. garden maintenance monthly, gutter cleaning quarterly, fire safety annually)
- **Auto-dispatch:** Scheduled maintenance auto-dispatched to assigned contractor at configured intervals
- **Essential safety measures (ESM):** Track and schedule mandatory inspections (fire safety, lifts, electrical, gas) per building regulations
- **Maintenance log:** Full history of all maintenance activities linked to common property assets

### 4.4 Contractor Management
- **Contractor directory:** Maintain approved contractor pool with trade category, ABN, insurance details, licence numbers
- **Insurance/licence expiry monitoring:** Auto-alert when contractor insurance or licence approaching expiry; suspend from pool if expired
- **Performance tracking:** Rate contractors on response time, quality, cost; inform future auto-assignment weighting
- **Contractor onboarding:** Self-service contractor registration portal with document upload

### 4.5 Asset Register
- **Common property asset tracking:** Register all significant common property assets (lifts, HVAC, hot water, intercom, gates, pools, gym equipment)
- **Lifecycle tracking:** Record age, warranty period, expected replacement date, estimated replacement cost
- **Capital works plan integration:** Asset data feeds into 10-year capital works plan and sinking fund projections

**Automation level:** Fully automated for under-threshold works and scheduled maintenance. Human decisioning for quotes over threshold, emergency post-hoc review, and contractor pool changes.

---

## 5. Insurance Management

### 5.1 Policy Tracking
- **Policy register:** Store all active insurance policies (reinstatement/replacement, public liability, office bearers, voluntary workers, fidelity guarantee)
- **Expiry monitoring:** Auto-alert committee 90/60/30 days before policy expiry
- **Certificate of currency storage:** Maintain current certificates accessible to all owners
- **Valuation reminders:** Prompt for building valuation updates per Act requirements

### 5.2 Renewal Workflow
- **Renewal notification:** Alert committee that renewal is due; present prior year premium and coverage summary
- **Broker integration (future):** If AR status obtained, facilitate quote comparison; otherwise, prompt committee to engage their broker
- **Resolution capture:** Record AGM or committee resolution on insurance placement

### 5.3 Claims Management
- **Claim lodgement:** Guided workflow for submitting insurance claims with required documentation
- **Claim tracking:** Track claim status, correspondence, and outcomes
- **Excess allocation:** Record how excess is apportioned (by resolution or policy)

**Automation level:** Reminders and document storage fully automated. Insurance placement decisions, broker selection, and claims lodgement require human decisioning. Note: providing insurance advice requires AFSL/AR status, so v1 should limit to administrative support only.

---

## 6. Compliance and Records Management

### 6.1 Document Repository
- **Centralised document store:** All OC documents stored and accessible to authorised users per their role
- **Document categories:** Plans of subdivision, rules, insurance, financial records, meeting minutes, contracts, maintenance records, correspondence, certificates
- **Access control:** Lot owners can access documents per s 146 of the Act; committee members have broader access
- **Retention policy:** Auto-enforce document retention periods per Act requirements (7 years for financial records)

### 6.2 OC Certificate Generation
- **Section 32 certificates:** Auto-generate OC certificates for lot owners selling their property (required for vendor statement)
- **Certificate fee collection:** Charge statutory fee via Monoova; auto-generate and deliver certificate
- **Content population:** Auto-populate certificate with current levy status, insurance details, sinking fund balance, special resolutions, pending works

### 6.3 Rules Management
- **Model rules reference:** Built-in reference copy of model rules (Schedule 2, OC Regulations 2018)
- **Custom rules tracking:** Record any custom rules registered with Land Victoria
- **Rule amendment workflow:** Support resolution process for amending rules; generate documents for Land Victoria registration
- **Rule distribution:** Auto-distribute current rules to new lot owners/tenants

### 6.4 Compliance Calendar
- **Statutory obligations tracker:** Auto-generated compliance calendar covering:
  - AGM timing (15-month maximum gap)
  - Insurance renewal dates
  - Essential safety measures inspection dates
  - Financial statement preparation deadlines
  - BAS lodgement dates (if applicable)
  - Annual statement lodgement (if registered manager)
  - Common seal custody (if applicable)
- **Proactive notifications:** Escalating reminders to committee as deadlines approach

### 6.5 Lot Owner Register
- **Ownership tracking:** Maintain current lot owner register with contact details
- **Transfer processing:** Update register on notification of lot sale/transfer
- **Tenant register:** Track tenants and their contact details (owners required to notify OC)
- **Privacy compliance:** Manage access to personal information per Privacy Act and OC Act requirements

**Automation level:** Certificate generation, compliance reminders, and document storage fully automated. Rule amendments require resolution (human vote). Register updates require notification from owners/conveyancers.

---

## 7. Communications

### 7.1 Owner/Resident Communications
- **Multi-channel delivery:** All communications available via in-app notification, email, and SMS (per owner preference)
- **Notice types:** Levy notices, meeting notices, maintenance updates, rule breach notices, general announcements
- **Correspondence log:** All inbound and outbound communications logged on event bus with timestamps
- **Owner self-service portal:** View levy status, submit maintenance requests, access documents, submit proxies, participate in votes, update contact details

### 7.2 Committee Communications
- **Committee discussion board:** Secure channel for committee deliberation outside formal meetings
- **Decision log:** All committee decisions captured with who approved/declined and timestamps
- **Delegation notifications:** Auto-notify relevant committee members when their approval is required

### 7.3 Dispute and Complaint Handling
- **Complaint submission:** Structured complaint form per Act requirements (must be in writing, in approved form)
- **Complaint triage:** AI categorisation and routing (noise, parking, common property damage, rule breach, inter-owner dispute)
- **Response workflow:**
  1. Acknowledge receipt (automated)
  2. Route to committee for review
  3. Committee decides action or no action
  4. If no action, system generates written reasons to complainant per Act requirements
- **Escalation pathways:** Information on CAV conciliation, mediation, and VCAT options provided when internal resolution fails
- **Rule breach notices:** Template-based breach notices generated and sent on committee approval

### 7.4 Noticeboard
- **Digital noticeboard:** Community announcements, upcoming works, social events
- **Emergency notifications:** Priority push notifications for urgent matters (water shutoff, fire alarm testing, security incidents)

**Automation level:** Delivery, logging, and acknowledgment fully automated. Complaint resolution decisions and breach notice approval require committee decisioning.

---

## 8. Amenities and Common Property Management

### 8.1 Amenity Booking (Already Built)
- **Booking system:** Reserve shared facilities (BBQ area, meeting room, gym, pool, car wash bay)
- **Rules enforcement:** Auto-enforce booking rules (time limits, advance booking periods, cleaning bonds)
- **Conflict detection:** Prevent double-booking; manage waitlists

### 8.2 Access and Key Management
- **Key/fob register:** Track common property keys, fobs, and access credentials issued to owners/tenants
- **Access request workflow:** Contractor access requests processed and logged
- **Smart lock integration (future):** API integration with smart lock systems for time-limited contractor access

### 8.3 Common Property Register
- **Boundary definition:** Reference plan of subdivision to define common property boundaries
- **Improvement tracking:** Record any alterations or improvements to common property with resolution authority

**Automation level:** Booking fully automated. Key register requires manual updates unless integrated with smart lock system.

---

## 9. Reporting and Analytics

### 9.1 Financial Dashboards
- **Real-time financial position:** Cash balance, receivables (outstanding levies), payables (unpaid invoices), fund balances
- **Levy collection rate:** Percentage of levies collected on time; arrears aging report
- **Budget variance:** Actual vs budget by category with trend analysis
- **Cash flow forecast:** Projected cash position based on expected levy receipts and known commitments

### 9.2 Operational Dashboards
- **Maintenance metrics:** Open requests, average resolution time, contractor performance
- **Compliance status:** Traffic light view of all compliance obligations (green/amber/red)
- **Communication metrics:** Notice delivery rates, portal engagement

### 9.3 Committee Reports
- **Auto-generated committee report:** Monthly or quarterly summary of financial position, maintenance activity, compliance status, and any items requiring committee attention
- **AGM report pack:** Complete AGM documentation auto-compiled (financial statements, budget, insurance summary, maintenance summary, committee report)

### 9.4 Lot Owner Reports
- **Individual lot statement:** View levy history, payment history, outstanding balance, and any pending matters
- **Annual statement:** Year-end summary for each lot owner's tax purposes

**Automation level:** Fully automated. All reports generated from event bus data.

---

## 10. Platform Administration and Revenue

### 10.1 Payment Processing Revenue
- **Levy payment processing:** Margin on NPP inbound payments via Monoova (primary revenue)
- **Contractor payment processing:** Margin on outbound payments to contractors
- **OC certificate fees:** Platform fee component on Section 32 certificate generation
- **Add-on services (future):** Premium features (advanced analytics, AI concierge for residents, smart building integrations) as paid tiers

### 10.2 Platform Operations
- **System health monitoring:** Uptime, payment processing status, notification delivery rates
- **Audit trail:** Complete event bus log accessible for regulatory review
- **Data backup and recovery:** Automated backups with defined RPO/RTO
- **Multi-jurisdiction support (future):** Configurable rule engine to support NSW (Strata Schemes Management Act 2015), QLD (Body Corporate and Community Management Act 1997), and other states

### 10.3 Regulatory Compliance (Platform Level)
- **BLA registration maintenance:** Annual statement and fee lodgement reminders (if GoodStrata is registered as OC manager)
- **PI insurance maintenance:** Track platform's own PI insurance renewal
- **Privacy and data handling:** Compliance with Australian Privacy Principles
- **Record keeping obligations:** Ensure platform meets all record keeping requirements under OC Act s 144

---

## 11. Human Decisioning Summary

The following is the complete list of actions that require human input. Everything else is autonomous.

| Decision | Who Decides | Trigger |
|----------|-------------|---------|
| Annual budget approval | Committee then AGM | System generates draft budget |
| Levy amount setting | AGM vote | Flows from budget approval |
| Committee election | AGM vote | System manages nominations and voting |
| Chair/secretary election | AGM/committee vote | System manages nominations and voting |
| Maintenance quote approval (over threshold) | Committee/treasurer | System presents quotes with comparison |
| Emergency works post-hoc review | Committee | System auto-approves then notifies |
| Debt recovery escalation (past 60 days) | Committee | System recommends; committee approves |
| Insurance broker selection/renewal | Committee | System reminds; committee engages broker |
| Insurance claim lodgement | Committee/affected owner | System provides workflow |
| Rule amendment | AGM (special resolution) | Owner/committee proposes motion |
| Rule breach action | Committee | System triages complaint; committee decides |
| Complaint resolution | Committee | System presents complaint; committee decides action |
| Payment plan approval (hardship) | Committee/treasurer | Owner requests; system presents to approver |
| Special levy raising | AGM/committee vote | System calculates; put to vote |
| Contractor pool changes | Committee | System recommends based on performance |
| Custom rules registration | Committee + Land Victoria | System generates documents |
| Meeting agenda additions | Lot owners/committee | Owners submit motions; system compiles |

---

## 12. Integration Points

| System | Purpose | Priority |
|--------|---------|----------|
| Monoova (NPP/PayID) | Inbound levy payments, outbound contractor payments | **Built** |
| Email (SES / generic SMTP) | Transactional notifications, levy notices, meeting notices (self-hosters can point at any SMTP server; defaults to a console/local sink) | **Built** |
| SMS (Twilio/MessageMedia) | Notifications, reminders, 2FA | **Built** |
| Video conferencing (Zoom/Teams API) | Virtual AGMs and committee meetings | High |
| Calendar (ICS generation) | Meeting invites and compliance calendar sync | Medium |
| Land Victoria API (if available) | Plan of subdivision data, lot ownership verification | Medium |
| ATO/SBR (future) | Automated BAS lodgement | Low (use BAS agent initially) |
| Smart lock APIs (future) | Contractor access management | Low |
| Building management systems (future) | IoT sensor data, energy monitoring | Low |
| Accounting export (Xero/MYOB) | Financial data export for external accountants/auditors | Medium |

---

## 13. MVP Scope (Launch Priorities)

### Must Have (Launch)
1. OC setup wizard with lot import and owner registration
2. Levy calculation, notice generation, and PayID payment collection
3. Payment reconciliation and receipt generation
4. Arrears tracking with automated reminder escalation
5. AGM workflow (notice, agenda, proxy, voting, minutes)
6. Maintenance request submission and work order dispatch
7. Document repository with access controls
8. Financial reporting (income/expenditure, lot statements)
9. Compliance calendar with automated reminders
10. Owner self-service portal

### Should Have (Fast Follow)
1. OC certificate generation (Section 32)
2. Contractor management with insurance tracking
3. Committee meeting workflow
4. Budget drafting and approval workflow
5. Accounts payable with invoice matching
6. Circular/written resolution voting
7. Asset register and maintenance scheduling
8. Reporting dashboards

### Nice to Have (Future)
1. AI-powered complaint triage and response drafting
2. Capital works plan and sinking fund modelling
3. Multi-jurisdiction support (NSW, QLD)
4. Smart lock integration
5. Building management system integration
6. Automated BAS lodgement
7. Insurance broker marketplace / AR integration
8. Resident AI concierge (natural language queries about rules, levies, etc.)

---

## 14. Key Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| BLA registration required | Regulatory compliance cost ($240 + PI insurance ~$5K/yr) | Budget for it; marginal cost at scale |
| AFSL required for insurance advice | Cannot touch insurance without licence | Scope insurance out of v1; admin support only |
| Trust accounting audit requirements | May need external audit depending on tier | Ensure event bus audit trail meets auditor requirements |
| Committee non-engagement | Decisions block if committee doesn't respond | Implement timeout rules, escalation to all owners, and default actions where Act permits |
| Data breach / privacy incident | Reputational and regulatory risk | SOC2/ISO27001 roadmap; encrypt PII at rest and in transit |
| Monoova outage | Payments disrupted | Implement fallback payment method (BPAY via alternate provider) |
| Legal challenge to "no human manager" model | Regulatory risk | Obtain legal opinion on whether platform constitutes "manager" under Act; structure accordingly |

---

*This specification covers the functional requirements for GoodStrata to operate as a fully autonomous OC management platform under Victorian legislation. Technical architecture, database schema, API specifications, and UI/UX design are out of scope for this document.*

# GoodStrata — Growth & Marketing Plan

_Free, open-source, AI-run owners-corporation management for Victoria/Australia._
_Founder-led. Movement-first. Non-spammy by design._

Last updated: 2026-07-03 · Owner: Jake (founder) · Status: v1 go-to-market

---

## 0. How to read this document

This is an operating plan, not a manifesto. It is built around one hard constraint: **the communities where our buyers gather are allergic to vendors**, and a single ban or "this is just an ad" pile-on can cost us the most valuable channel we have. So every play here is founder-led, evidence-first, and gives value before it asks for anything. The product is genuinely free and Apache-2.0 — that is not a marketing line, it is the thing that lets us participate in an anti-commercial movement without being the commercial intruder.

Live assets this plan leans on (all already shipped):
- **Fee-check lead magnet:** `goodstrata.com.au/what-am-i-paying/` — drop in AGM papers / budget / a phone photo, get your manager's real annual cost in dollars. Document not stored. **This is the tip of the entire funnel.**
- **Self-resetting live demo:** `demo.goodstrata.com.au` — "click anything," it resets itself.
- **Rally-your-building kit (forwardable PDFs):** one-pager, committee decision pack (motion wording + objections + switching checklist), transparency explainer — at `goodstrata.com.au/for-owners/`.
- **Proof:** `goodstrata.com.au/blog/announcing-goodstrata/` — a real 12-lot Fitzroy walk-up run for a month on one laptop with a local model: 110 audited events, **1** human decision, **$0.00** of money computed by an LLM.
- **Source:** `github.com/goodstrata/goodstrata` (Apache-2.0, whole platform).

---

## 1. Executive summary + the core wedge

### The situation
Australian strata is a consolidated, vertically integrated industry (PICA, Bright & Duggan/Johns Lyng, Steadfast across insurance + funding + repairs) whose economics depend on charges the owner never sees. Meanwhile owners are already leaving: in Victoria only schemes with **>100 lots (~1% of all schemes)** legally require a manager, **84% of schemes have ≤10 lots**, and **~40% are already self-managed** — but "largely invisible" and under-served. There is a live, organised owner-empowerment movement (Strata Owners Alliance / "Strata Chat Australia," the subject of a June 2026 Guardian feature) actively looking for exactly the tool we built. The industry lobby (SCA Vic) has publicly named "owners' groups" a **threat** and is lobbying to make managers mandatory for schemes **>10 lots** — a direct attack on owner autonomy. That is our rallying narrative, handed to us.

### The core wedge
**"Schedule A vs Schedule B."** Managers win tenders on a low, headline base fee (VIC ~$300–$500/lot/yr) and make their real money on pay-as-you-go extras (Schedule B) that add 20–50% in a normal year and can double the base — plus **invisible insurance commissions (often 10–20% of premium)** and contractor kickbacks. Documented abuses: billing for phantom arrears notices ($101.48 to chase a 60-cent debt), $600 for an automated tax report, a $945 "safety report" that was a recycled 2015 document.

Our wedge is to **make the invisible number visible, then make it $0.**
1. **Reveal** — the fee-check tool turns a shoebox of AGM PDFs into one plain-dollar figure: "this is what your manager costs you."
2. **Reframe** — most of that spend is admin (levies, arrears, repair booking, AGM notices) that is now automatable.
3. **Replace** — GoodStrata does the admin with AI agents, humans approve anything that spends money, every action is on an append-only log, and it's **free for the owners corporation** (revenue is only a flat, published margin on payments that move — no commissions, no kickbacks, nothing to steer).

### The positioning, in one line
> **GoodStrata is free infrastructure for the owner-empowerment movement — the automated "DIY strata handbook" owners have been asking for — not another strata startup angling for your contract.**

### Why we win the trust argument (the objection that kills most AI pitches)
The money is **deterministic, tested code, never the AI.** Apportionment, penalty interest, reconciliation and vote weighting are code you can read on GitHub. "If every AI model turned into a random number generator tomorrow, your levies would still sum to the budget to the cent." The AI only proposes; a human approves anything that spends money or binds the building; and it's all on a log not even we can edit.

### What success looks like (12 months, directional)
- A recognised, welcomed presence in the independent owners' community (invited, not tolerated).
- The fee-check tool as the movement's default "what am I actually paying?" utility.
- A pipeline of self-managing and switching buildings running real demos, with a handful of lighthouse buildings live and documented.

---

## 1.5 The field — convergent, not copied (and what's genuinely ours)

GoodStrata did not copy anyone. The **problem** — opaque, conflicted, expensive strata management owners want to escape — is a public, movement-level story (ABC *Four Corners*, the June 2026 *Guardian* feature, the Strata Owners Alliance, explicit r/AusPropertyChat demand for exactly this). Many people converging on "owners should self-manage with better tools" is **market validation, not IP**.

The closest convergent effort is **StrataBot.ai** (Guy Kennedy) — same movement, same channels, same "software, not a strata manager" stance. Treat them as an **ally against the incumbents, not a target.** But our thesis is distinct and further along:

| Genuinely GoodStrata's own | StrataBot / the field |
|---|---|
| **Autonomous agents that DO the work** — levies, arrears, repairs, meetings — under a *propose → human decides → code executes* gate | Digital voting + issue tracking + a legal-Q&A chatbot; an AI *co-pilot* (suggestions) and financial control are **2026 roadmap** |
| **Deterministic money** — the LLM never computes a dollar; money is tested code | not claimed |
| **Append-only audit log as the trust primitive** — "trust the architecture, not the AI" | not claimed |
| **Free forever + Apache-2.0 open-source** (revenue only from a published payment margin) | 3-month trial → paid, closed source |
| **A whole building run on one laptop with a local model** (proven) | — |

**Positioning rules that follow:**
1. **Differentiate only on the four things that are ours** — *autonomous now · deterministic money · audit-first · free + open*. Never attack StrataBot; punching down at a fellow owner-led reformer cedes the moral high ground the whole wedge stands on.
2. **Keep our voice our own.** Do **not** echo StrataBot's staked-out lines ("Take Back Control", "corruption-free alternative", leading with Four Corners). Convergent on the *problem* is fine — mirroring their *taglines* is the one move that would actually look like copying. Lead with our distinct language: **agents do the work, you decide, every action is on the record, and the code is public.**

## 2. Target audience + channel matrix

### 2.1 The two buyers (and one influencer)
- **The frustrated owner-occupier** — got a confusing AGM pack or a surprise special levy, suspects they're being fleeced, doesn't yet know they can leave. **Entry point: the fee-check tool.**
- **The committee member / would-be self-manager** — treasurer/secretary/chair or the "one motivated owner," already doing spreadsheets, actively looking for a handbook/tool. **Entry point: the demo + committee decision pack.**
- **The movement influencer** — Strata Owners Alliance admins, self-management bloggers, consumer journalists. Not buyers, but they decide whether we're welcomed or flamed. **Entry point: contribute value, never pitch.**

### 2.2 Channel matrix

Legend — **Risk**: promo sensitivity/ban risk. **Mode**: Founder-led (F) or Paid (P).

| # | Channel | Audience it reaches | Reach (est.) | Promo rules / risk | The authentic play | Cadence | Mode |
|---|---------|--------------------|--------------|--------------------|--------------------|---------|------|
| 1 | **Strata Chat Australia** (FB group, Strata Owners Alliance) | Bullseye ICP: owners + committee, self-management-minded, VIC/NSW/QLD | Low tens of thousands | **VERY HIGH** — anti-commercial ethos, admins critique vendors publicly. One bad post = burned | Show up as a self-managing owner/builder. Answer fee/arrears/AGM questions with real help. Share the **fee-check tool as a free utility**, not a product. Offer the open-source repo as a community asset. Get admin blessing before any "here's what I built" post | Daily light presence; substantive help 3–5x/wk; 1 "what I built" post only after 3–4 wks of genuine contribution + admin OK | F |
| 2 | **r/straya-adjacent + r/AusPropertyChat, r/AusFinance, r/melbourne, r/fiaustralia** | Owners researching "is my strata ripping me off" | Large, diffuse | **HIGH** — self-promo rules, mods remove links. Comment karma matters | Answer strata threads with genuinely useful breakdowns (Schedule A/B, insurance commission math). Link the fee-check tool only when it directly answers the question. Do a transparent "I built this, AMA, it's free + open source" post in the right sub with mod pre-clearance | 2–4 helpful comments/wk; 1 flagged self-post/month max per sub | F |
| 3 | **r/stratachataus / dedicated strata subs** | Self-selecting strata-obsessed owners | Small, high-intent | **MEDIUM** — more tolerant of tools if useful | Deeper technical answers; post the Fitzroy case study as "here's a month of a building run this way, transcripts included" | Weekly | F |
| 4 | **Founder blog on goodstrata.com.au/blog** | Everyone downstream of search + social; the canonical source | Owned, compounding | **NONE** (owned) | The content engine's home. Evergreen explainers: "How to read your AGM pack," "The real cost of Schedule B," "How to switch strata managers in Victoria," case studies | 1 substantial post/wk | F |
| 5 | **LinkedIn (founder profile)** | Committee professionals, prop-tech, journalists, prospective self-hosters/devs | Medium | **LOW** | Build-in-public: the movement narrative, the SCA "threat" story, product milestones, the open-source angle. Tag the Guardian piece's themes | 3x/wk | F |
| 6 | **YouTube / TikTok / Instagram Reels / FB Reels** | Cold owners; discovery via the fee-check hook | Potentially large | **LOW** (own channel) | Short vertical video: the 5 ad-reel concepts in §6, plus "drop your AGM, see the number" demos and 60-sec explainers | 2–3 shorts/wk | F (organic) → P |
| 7 | **X/Twitter (founder)** | Tech, open-source, prop-tech, journalists | Medium | **LOW** | Build-in-public threads; amplify GitHub, deterministic-money argument, demo clips | 3–5x/wk | F |
| 8 | **Email (fee-check opt-in list)** | Warm — people who already ran their number | Grows from funnel | **NONE** (opted in) | After a fee-check, optional "email me the switching checklist." Nurture: how to raise it at the AGM, the committee pack, book a demo | Weekly-ish nurture; triggered sequences | F |
| 9 | **Consumer / property journalists** (Guardian, ABC, Domain, realestate.com.au, The Age) | Mass owner audience via earned media | Very large | **LOW** but earns scrutiny | Pitch the movement + a clean data story ("we ran a whole building for a month on a laptop; here's every audited event"). The Four Corners "Strata Trap" and Guardian angles are live | Ongoing outreach; 1 pitch/month | F |
| 10 | **Local / community: OC noticeboards, body-corporate forums, Facebook building groups, Neighbourhood/strata meetups, Landlord/investor forums (PropertyChat, Somersoft)** | Hyperlocal owners at the moment of switching | Small, very high-intent | **MEDIUM** | The printable one-pager literally designed for noticeboards. Local VIC meetups; offer to demo | Opportunistic; support inbound "how do I rally my building" | F |
| 11 | **Meta ads (FB/IG), retargeting** | Cold VIC/AU owners; lookalikes of fee-check users | Scalable | **LOW** (paid) | Only after organic proves the hook. Run the reels; retarget fee-check visitors who didn't finish; geo-target VIC metro strata suburbs | Phase 3, always-on once ROAS proven | P |
| 12 | **YouTube / Google Search ads** | High-intent searchers ("strata fees too high," "self manage owners corporation Victoria," "switch strata manager") | Scalable | **LOW** (paid) | Capture intent to the fee-check and the for-owners switching guide | Phase 3 | P |
| 13 | **GitHub / Hacker News / dev communities** | Self-hosters, technical owners, credibility halo | Medium | **MEDIUM** (HN hates marketing) | "Show HN: open-source, AI-run strata management, money is deterministic code" — technical, honest, no hype | One-shot launch post + ongoing repo hygiene | F |

**Channel priority order:** 1 → 4 → 6/8 (funnel plumbing) → 2/3/5/7 → 9/13 → 11/12 (paid last).

---

## 3. Messaging: pillars, objections, hooks

### 3.1 The one-line frame (say this first, everywhere)
> Your strata manager's job is mostly admin — issuing levies, chasing arrears, booking the plumber, sending the AGM notice. GoodStrata does that with AI agents, **free for the owners corporation**, and every action is on a log you can read. **You still decide everything that matters.**

### 3.2 Message pillars (one sharp line each)
1. **See what you actually pay.** "You're paying $300–$600 a lot a year plus insurance commissions you were never shown. Drop in your AGM papers and see the real number."
2. **Transparency by construction, not by promise.** "Every fee, every action, every AI tool-call lands on an append-only log — there's only one book, and not even we can edit it."
3. **Free, and open enough to prove it.** "Free for your owners corporation — not freemium, free. Apache-2.0 on GitHub, so 'no catch' and 'no lock-in' are things you can read, not take on faith."
4. **Agents do the work, you keep control.** "AI runs the day-to-day; humans approve anything that spends money or binds the building. The software can only propose — you decide."
5. **The money is code, never the AI.** (Trust closer) "Apportionment, penalty interest and reconciliation are deterministic, tested code — if every AI model became a random number generator tomorrow, your levies would still sum to the budget to the cent."

### 3.3 Objection → rebuttal table

| Objection | Tight rebuttal |
|-----------|----------------|
| "Can I trust an AI with our money?" | The AI never moves or computes money. Levies, interest and reconciliation are deterministic, tested code on GitHub. The AI only drafts and proposes; a human approves anything that spends. |
| "'Free' — what's the catch?" | The catch is transparent and on one page: a small, published margin on payments that actually move (levies in, contractor payments out). No insurance commissions, no kickbacks, no invoice markups. Read it, or read the code. |
| "We're not technical / we can't run software." | You don't have to host it — use the free hosted tier. Self-host is there for those who want it (Postgres + one process), but it's an option, not a requirement. |
| "Is this even legal / compliant in Victoria?" | GoodStrata handles the OC Act workflow (levies, notices, meetings, records). See the for-owners switching guide and committee decision pack; you keep full records and can export everything, anytime. |
| "What if you go bust or disappear?" | It's Apache-2.0 and self-hostable. Your ledger and event log export in open formats. "No lock-in" is guaranteed by the licence, forever — not by our goodwill. |
| "Our committee will never agree to change." | You don't need the committee first — you need a 10-minute demo, one page for the noticeboard, and one line on the next agenda. The committee decision pack has the motion wording and honest answers to every objection. |
| "AI will hallucinate our minutes / invent decisions." | In our month-long test it drafted minutes "without inventing a word," and every one of 110 actions is on the audit log for you to check. Humans approve before anything is final. |
| "Sounds too good — is it real?" | We ran a real 12-lot Fitzroy building for a full month on one laptop with a local model. 110 audited events, 1 human decision, $0.00 of money computed by an LLM. Full transcripts published. |

### 3.4 Hook bank (for posts, thumbnails, ad first-lines)
- "Drop your AGM pack in. See what your strata manager actually costs you. It takes 30 seconds and we don't keep the file."
- "Your manager charged $101.48 to chase a 60-cent debt. Here's how to see every fee like that in your own building."
- "84% of Victorian strata schemes don't legally need a manager. Most don't know it."
- "The strata lobby put 'owners' groups' on its list of *threats*. Good. Let's be a bigger one."
- "Free strata management. Not freemium. Free. And the whole thing is on GitHub."
- "We ran a whole apartment building for a month — on one laptop. One human decision the entire month."
- "The money is code, never the AI. If the AI broke tomorrow, your levies would still sum to the cent."
- "There was no DIY handbook for self-managing your building. So we built one that runs itself."
- "Insurance commissions are the fee you were never shown. Here's how to find yours."
- "One motivated owner can switch a whole building. Here's the exact script."

---

## 4. Phased 90-day go-to-market

**Guiding rule:** value before ask, always. We earn the right to mention the product with weeks of genuine help first.

### Phase 1 — Authentic seeding (Weeks 1–4)
_Goal: become a known, useful, non-vendor presence; get the fee-check tool into the movement's hands; collect the first case studies and email opt-ins._

- **Set up the plumbing (Week 1):** confirm fee-check email opt-in + switching-checklist sequence; analytics/UTMs on every link; a tracked short-link for the fee-check; publish 2 pillar blog posts so social has somewhere to point.
- **Join and listen (Week 1):** get into Strata Chat Australia and the key subreddits. Read a week of threads. Note recurring questions (arrears, insurance jumps, AGM confusion, bad managers). **Do not post product.**
- **Contribute (Weeks 1–4):** answer 3–5 real questions/week in FB + 2–4 Reddit comments/week with genuinely useful, source-backed help. Mention the fee-check tool **only** where someone is literally asking "how do I know what I'm paying?"
- **Reach out to admins (Week 2):** privately message Strata Owners Alliance admins — introduce yourself as a self-managing builder, offer the open-source repo + fee-check as free community assets, ask what would actually help their members. Ask permission before any "what I built" post.
- **Founder build-in-public (Weeks 1–4):** LinkedIn 3x/wk, X 3–5x/wk — the movement narrative, the SCA "threat" story, milestones.
- **First video (Weeks 3–4):** publish Reel #1 (fee-check flagship) organically to YouTube/TikTok/IG/FB.
- **The one "what I built" post (Week 4, only with admin OK):** honest, movement-framed, links demo + repo + fee-check.

**Exit criteria:** ≥1 admin relationship; ≥50 fee-check runs; ≥15 email opt-ins; 2 pillar posts + 1 reel live; ≥1 building doing a real demo.

### Phase 2 — Content engine (Weeks 5–8)
_Goal: turn genuine help into compounding owned content and repeatable demand._

- **Weekly pillar post** (blog) → sliced into LinkedIn/X threads + 1–2 reels each. Topics: reading your AGM pack; the Schedule B autopsy; insurance-commission math; the Victoria switching walkthrough; a real case study.
- **2–3 short videos/week** across YT/TikTok/IG/FB (reels from §6 + demo clips + explainers).
- **Community cadence continues** (help first): now you can reference blog posts as answers ("I wrote this up here") — value, not pitch.
- **Email nurture** live: fee-check → checklist → "raise it at the AGM" → committee pack → book a demo.
- **Ship the Show HN / GitHub launch** (Week 6–7): technical, honest, deterministic-money angle.
- **First journalist pitch** (Week 8): movement + laptop-building data story.
- **Recruit 2–3 lighthouse buildings:** offer white-glove onboarding in exchange for a documented case study.

**Exit criteria:** content cadence steady; ≥250 cumulative fee-check runs; ≥75 email list; ≥1 lighthouse building live; HN/GitHub post done; 1 journalist conversation open.

### Phase 3 — Paid amplification (Weeks 9–12)
_Goal: pour fuel only on hooks organic already proved._

- **Meta ads:** take the top-performing organic reel (by watch-through + fee-check clicks) and run it cold to VIC metro strata suburbs; **retarget** fee-check visitors who didn't opt in; build lookalikes off fee-check completers.
- **Google/YouTube search ads:** capture high-intent queries → fee-check + for-owners switching guide.
- **Scale what converts:** kill anything without a fee-check-run or demo-start CTA firing; double down on winners.
- **Keep Phase 1–2 running:** paid never replaces founder-led community + content; it amplifies it.
- **Lighthouse case studies** become the social proof in both ads and community.

**Exit criteria:** a positive-signal paid loop (cost per fee-check-run and cost per demo-start you'd pay again); ≥3 documented lighthouse buildings; a repeatable weekly machine.

### Weekly cadence at a glance (steady state, from Phase 2)
- **Mon:** publish pillar blog post; schedule the week's reels.
- **Tue–Thu:** 3–5 genuine community answers (FB+Reddit); LinkedIn/X build-in-public; 1 reel/day drip.
- **Fri:** email nurture send; review analytics; pick next week's topic from real questions asked.
- **Ongoing:** respond to every fee-check/demo inbound within a day; nurture admin + journalist relationships.

---

## 5. Content calendar — first 4 weeks (concrete)

Formats: **BLOG** (goodstrata.com.au/blog), **FB** (Strata Chat, help-first), **RED** (Reddit), **LI/X** (founder), **REEL** (short vertical video), **EMAIL**.

### Week 1 — Show up, help, plumb the funnel
- **BLOG:** "How to actually read your AGM financial pack (and spot the fees you're not meant to notice)." Ends with fee-check CTA.
- **BLOG:** "Schedule A vs Schedule B: how a $400/lot strata fee quietly becomes $700." (the wedge, fully explained, with the phantom-notice and recycled-report examples).
- **FB (Strata Chat):** No product. 3 genuinely helpful replies on arrears / insurance-jump / bad-manager threads. Introduce yourself in any welcome thread as a self-managing owner + builder.
- **RED (r/AusPropertyChat / r/melbourne):** 2 helpful comments breaking down a poster's fees; link the AGM blog post only if directly asked "how do I tell?"
- **LI:** "84% of Victorian strata schemes don't legally need a manager. The lobby just called owners' groups a *threat*. Here's why that's the story of the year." (movement narrative, no product)
- **X:** build-in-public thread: "I built free, open-source, AI-run strata management. The money is deterministic code, never the AI. Here's why that design choice matters. 🧵"
- **EMAIL:** finalise the fee-check → switching-checklist opt-in sequence (setup, not send).

### Week 2 — Deepen, earn the admin relationship
- **BLOG:** "The insurance commission you were never shown: how to find it in your own strata." (10–20% math, how to read the disclosure).
- **FB:** 4 helpful replies. Privately DM Strata Owners Alliance admins: offer repo + fee-check as free community assets; ask what helps members; ask permission for a future "what I built" post.
- **RED:** 1 mod-pre-cleared value post in a strata/AusFinance sub: "I mapped out exactly how strata managers make money beyond the base fee — sharing the breakdown." (No hard sell; tool linked as a footnote resource.)
- **LI:** repurpose the insurance-commission post as a carousel/thread.
- **X:** clip of the deterministic-money code path from GitHub — "here is literally the function that computes your levies; read it."
- **REEL #? (prep):** storyboard + generate Reel #1 (fee-check flagship) via Higgsfield.

### Week 3 — Proof + first video
- **BLOG:** "We ran a whole 12-lot building for a month on one laptop. Here's every number." (case study, transcripts, the 110/1/$0.00 stats).
- **REEL #1 (fee-check flagship)** published to YouTube/TikTok/IG/FB.
- **FB:** 3–5 helpful replies. Where someone asks "how do I even know if my manager is fair," share the fee-check tool as a utility.
- **RED (r/stratachataus / strata sub):** post the case study — "a month of a self-run building, transcripts included, AMA."
- **LI/X:** the case-study stats as a punchy graphic ("1 human decision in a month").
- **EMAIL:** first nurture send to opt-ins — "You saw your number. Here's exactly how to raise it at your next AGM."

### Week 4 — The (permissioned) reveal + momentum
- **BLOG:** "How to switch strata managers in Victoria — the exact steps, the motion wording, and the objections you'll hear." (mirrors the for-owners page + committee pack).
- **FB (only with admin OK):** the one "here's what I built, it's free and open source, built for exactly this community" post — movement-framed, links demo + repo + fee-check + one-pager.
- **REEL #2 (Schedule B autopsy)** published.
- **RED:** answer-and-link the switching guide on relevant "how do I leave my manager" threads.
- **LI:** "Show HN went live / GitHub milestone" build-in-public update; **X:** same.
- **EMAIL:** "The committee decision pack — everything your committee needs to decide in one meeting."
- **Review:** which hook drove the most fee-check runs? That one goes into Phase 3 paid.

---

## 6. Five ad-reel concepts (ready for Higgsfield generation)

All: **9:16 vertical, ~20–30s, en-AU voice, clean modern UI aesthetic, warm off-white (#faf9f6) / near-black (#15181f) brand palette.** On-screen text is burned in; keep captions short and high-contrast. Each ends on the same visual system (logo + URL) for brand consistency. Voiceover is plain, calm, Australian — never hypey.

---

### REEL 1 — "The Number" (FLAGSHIP fee-check dramatisation)
- **Title:** _See what your strata manager actually costs you._
- **Hook (first 3s):** Close-up of a thick, dog-eared AGM pack thudding onto a kitchen table. Text slams on: **"What does your strata manager actually cost you?"**
- **Format/aspect/length:** 9:16, ~28s.
- **Target channel:** Meta (FB/IG) + TikTok + YouTube Shorts. The workhorse.
- **CTA:** "Drop your AGM in at goodstrata.com.au/what-am-i-paying — free, 30 seconds, we don't keep the file."
- **Storyboard:**

| # | On-screen text | Visual | Voiceover |
|---|----------------|--------|-----------|
| 1 | "What does your strata manager actually cost you?" | AGM pack thuds onto a kitchen table; hand flips pages of dense figures | "Somewhere in here is what your strata manager really charges you." |
| 2 | "$400/lot… or is it?" | Finger traces a line item; numbers blur, a question mark hovers | "The base fee is the number they show you." |
| 3 | "+ meeting fees + arrears notices + 'admin time'" | Hidden fees fade in stacking on top of the base like bricks | "The extras are the ones they don't." |
| 4 | "+ insurance commission you were never shown" | A greyed-out line labelled 'commission' lifts out of the shadows | "And a commission on your insurance you never saw." |
| 5 | "Just take a photo of the page." | Phone lifts, snaps the AGM page; upload spinner on a clean web UI | "So take a photo of the page, and drop it in." |
| 6 | "$6,480 / year" | The real total counts up dramatically on screen, bold | "In seconds, the real number — in plain dollars." |
| 7 | "GoodStrata does the same admin. For $0." | Split screen: the big number vs a clean "$0" | "GoodStrata does that same admin with AI. Free for your owners corporation." |
| 8 | "You still decide everything that matters." | Calm shot of a person tapping 'Approve' on a decision card | "Agents do the work. You just decide." |
| 9 | "goodstrata.com.au/what-am-i-paying" | Logo + URL on off-white; "free · open source · we don't store your file" | "See your number. It's free." |

---

### REEL 2 — "The Schedule B Autopsy"
- **Title:** _How a $400 strata fee quietly becomes $700._
- **Hook (first 3s):** A single clean invoice line "$400/lot" on screen. Text: **"This is the fee that won the tender."** Then extras start dropping in.
- **Format/aspect/length:** 9:16, ~25s.
- **Target channel:** TikTok + Reels + YouTube Shorts (education/outrage hook).
- **CTA:** "Find every fee like this in your own building → goodstrata.com.au/what-am-i-paying"
- **Storyboard:**

| # | On-screen text | Visual | Voiceover |
|---|----------------|--------|-----------|
| 1 | "This is the fee that won the tender." | A tidy "$400 / lot" card, green tick | "This is the fee your strata manager quoted to win the job." |
| 2 | "$180 committee meeting" | A fee card drops on top with a thunk | "Then there's a charge for the meeting." |
| 3 | "$90 arrears notice ×34" | Cards stack faster; a red counter ticks up | "And a fee per arrears notice — even for debts of a few cents." |
| 4 | "$600 'automated' tax report" | Card labelled 'automated report' lands | "Six hundred dollars for a report a computer generated." |
| 5 | "$945 safety report (from 2015)" | Dusty document with '2015' stamp drops on | "A safety report that was really just a recycled 2015 file." |
| 6 | "$400 → $700+" | The stack collapses into one big total | "The headline fee was never the real fee." |
| 7 | "None of this is on the AI. The money is code." | Cut to clean GoodStrata ledger, every line itemised | "GoodStrata itemises every cent — and the money math is open-source code, not a black box." |
| 8 | "Free for your owners corporation." | Logo + URL | "See what you're really paying. It's free." |

---

### REEL 3 — "One Laptop, One Building, One Decision" (proof)
- **Title:** _We ran a whole apartment building on one laptop._
- **Hook (first 3s):** A single laptop glowing on a desk at night. Text: **"We ran a whole apartment building on this. For a month."**
- **Format/aspect/length:** 9:16, ~24s.
- **Target channel:** YouTube Shorts + LinkedIn + X (credibility/proof audience).
- **CTA:** "Read every transcript → goodstrata.com.au/blog"
- **Storyboard:**

| # | On-screen text | Visual | Voiceover |
|---|----------------|--------|-----------|
| 1 | "We ran a whole apartment building on this." | One laptop, dark room, terminal + clean UI glowing | "We took a real 12-lot building in Fitzroy and ran a full month of management — on one laptop." |
| 2 | "Arrears chased — correct to the cent." | Ledger animates, balances reconcile to $0.00 | "Arrears chased, correct to the cent." |
| 3 | "Roof leak → triaged → plumber dispatched." | A repair card flows from 'reported' to 'dispatched' under a threshold line | "A roof leak triaged and a plumber dispatched — under a limit the code enforces." |
| 4 | "Minutes drafted — not a word invented." | AGM minutes type out cleanly | "Minutes drafted without inventing a word." |
| 5 | "110 audited events." | Big number counts up on the append-only log | "A hundred and ten actions — every one on a log you can read." |
| 6 | "1 human decision. All month." | A single 'Approve' tap glows | "And exactly one human decision the entire month." |
| 7 | "$0.00 of money computed by an AI." | Bold "$0.00", then the code function behind it | "No money was ever computed by the AI. That's deterministic code." |
| 8 | "Free. Open source. Read every line." | Logo + GitHub URL | "It's free, it's open source, and every transcript is published." |

---

### REEL 4 — "The Threat" (movement / rally)
- **Title:** _The strata lobby called owners a threat. Good._
- **Hook (first 3s):** Hard cut to bold text on black: **"The strata industry put 'owners' groups' on its list of THREATS."** A highlighter swipes the word *threats*.
- **Format/aspect/length:** 9:16, ~22s.
- **Target channel:** FB Reels + TikTok + LinkedIn (movement/rally audience). Use with care in-group; primarily paid/organic on own channels.
- **CTA:** "Rally your building → goodstrata.com.au/for-owners"
- **Storyboard:**

| # | On-screen text | Visual | Voiceover |
|---|----------------|--------|-----------|
| 1 | "'Owners' groups' = a THREAT" | Redacted-document look; 'threat' highlighted | "The strata lobby's own plan lists owners' groups as a threat." |
| 2 | "They want managers made *mandatory* for buildings over 10 lots." | Gavel / regulation motif; a padlock clicks over a small building | "And they're pushing to force a paid manager on even small buildings." |
| 3 | "84% of Victorian schemes are 10 lots or fewer." | A city of small buildings lights up | "But most Victorian buildings are small — and don't legally need one." |
| 4 | "~40% already run themselves." | A share of the buildings turns a confident colour | "Roughly four in ten already manage themselves. Quietly." |
| 5 | "There was no handbook. So we built one." | The GoodStrata dashboard resolves into view | "There was never a DIY handbook. So we built one — that runs itself." |
| 6 | "Free. Open source. Yours." | One-pager PDF slides onto a noticeboard | "Free for your owners corporation. Open source. Yours to keep." |
| 7 | "One motivated owner can switch a whole building." | Hand pins the one-pager; neighbours gather | "One motivated owner can move a whole building." |
| 8 | "goodstrata.com.au/for-owners" | Logo + URL | "Rally yours." |

---

### REEL 5 — "Can I Trust an AI With Our Money?" (objection-killer)
- **Title:** _The AI never touches your money._
- **Hook (first 3s):** A worried face / comment bubble: **"Trust an AI with our building's money? No way."** Then a calm cut.
- **Format/aspect/length:** 9:16, ~24s.
- **Target channel:** Meta retargeting (people who ran the fee-check but hesitated) + YouTube Shorts.
- **CTA:** "See the demo, read the code → demo.goodstrata.com.au"
- **Storyboard:**

| # | On-screen text | Visual | Voiceover |
|---|----------------|--------|-----------|
| 1 | "'Trust an AI with our money?'" | A skeptical comment bubble on screen | "It's the first thing everyone asks — can you trust an AI with the building's money?" |
| 2 | "You shouldn't. So we didn't." | Text flips confidently | "You shouldn't. So we didn't build it that way." |
| 3 | "The AI only drafts and suggests." | AI card labelled 'proposes' — greyed, no money icon | "The AI drafts notices and suggests actions. That's all." |
| 4 | "The money is deterministic code." | Cut to the actual apportionment function on GitHub | "Every dollar — levies, interest, reconciliation — is deterministic, tested code." |
| 5 | "If the AI broke, your levies still sum to the cent." | Numbers reconcile perfectly even as an 'AI' node glitches out | "If the AI turned to noise tomorrow, your levies would still add up to the cent." |
| 6 | "Anything that spends money stops for a human." | A decision card waits on 'Approve' | "And anything that spends money waits for a person to approve it." |
| 7 | "Every step on a log not even we can edit." | Append-only log scrolls | "All of it on a log — append-only, even we can't change it." |
| 8 | "Try it. Read the code. It's free." | Logo + demo URL + GitHub | "Try the live demo. Read every line. It's free." |

---

**Higgsfield production notes for the orchestrator:**
- Generate each reel as a sequence of image frames (`generate_image`) → animate (`generate_video`), or use the explainer/shorts workflow (`get_workflow_instructions` → shorts/UGC/explainer) for narrated builds.
- Keep a consistent brand kit across all five: off-white `#faf9f6` backgrounds, near-black `#15181f` text/UI, one restrained accent; the same end-card (logo + URL) every time.
- Use `create_voice` / `generate_audio` for a single consistent calm en-AU narrator across all reels.
- Run `virality_predictor` on Reel 1 and Reel 2 variants before committing paid budget; promote the winner into Phase 3.
- Reel 1 is the flagship — produce it first and in 2–3 hook variants (different opening line/number) for A/B testing.

---

## 7. Measurement — what to track

**North-star:** fee-check runs → demo starts → buildings onboarded. Everything else is a leading indicator of these.

### Funnel metrics (weekly)
- **Top:** impressions/views per channel; reel watch-through rate (esp. 3-sec hook hold); community post reach + sentiment.
- **Mid (the money step):** **fee-check runs** (the single most important number), fee-check completion rate, email opt-ins from fee-check.
- **Bottom:** demo starts (`demo.goodstrata.com.au`), "start a building" clicks (`my.goodstrata.com.au`), committee-pack/one-pager PDF downloads, buildings actually onboarded, lighthouse case studies produced.

### Channel health
- Per-channel: cost per fee-check-run (paid), cost per demo-start (paid), organic reach vs. saved/shared ratio, click-through to fee-check.
- **Community-specific (guardrails):** ratio of help-comments to any-link-comments (keep it high, e.g. ≥5:1); admin/mod sentiment; removed-post or flag count (target: zero); DMs/inbound "how do I rally my building" requests (a golden signal).

### Content
- Which **hook** drives fee-check runs (attribute via UTM/short-links) — feeds Phase 3 ad selection.
- Blog: organic search impressions + rankings for "switch strata manager victoria," "strata fees too high," "self manage owners corporation."
- Reels: watch-through, shares, saves, comment sentiment, link clicks; `virality_predictor` score vs. actual.

### Earned media / movement
- Journalist replies + placements; backlinks; mentions in the owners' community; GitHub stars/forks/issues as a proxy for technical trust.

### Review cadence
- **Weekly:** funnel dashboard + "what question did the community ask most?" → next week's content.
- **Monthly:** channel ROI review, kill/scale decisions, case-study progress, admin/journalist relationship status.
- **End of each phase:** check exit criteria (§4) before advancing spend.

**Instrumentation to stand up in Week 1:** UTM convention on every link; tracked short-links per hook; fee-check-run + demo-start as explicit analytics events; an email opt-in tag; a simple weekly dashboard.

---

## Appendix — Asset & link inventory

| Asset | URL | Use |
|-------|-----|-----|
| Fee-check tool (lead magnet) | goodstrata.com.au/what-am-i-paying/ | Top-of-funnel hook, every channel |
| Live self-resetting demo | demo.goodstrata.com.au | Mid-funnel proof; "click anything" |
| Start a building | my.goodstrata.com.au | Conversion |
| How it works | goodstrata.com.au/how-it-works/ | Explainer / decision-gate story |
| How we make money | goodstrata.com.au/how-we-make-money/ | "What's the catch" rebuttal |
| Open source / self-host | goodstrata.com.au/open-source/ | Trust + dev audience |
| For owners (switching + script) | goodstrata.com.au/for-owners/ | Rally + switching in VIC |
| Case study blog | goodstrata.com.au/blog/announcing-goodstrata/ | Proof (110 events / 1 decision / $0.00) |
| One-pager PDF | goodstrata.com.au/downloads/goodstrata-one-pager.pdf | Noticeboard / forward-to-neighbour |
| Committee decision pack PDF | goodstrata.com.au/downloads/goodstrata-committee-decision-pack.pdf | Motion wording + objections |
| Transparency explainer PDF | goodstrata.com.au/downloads/goodstrata-how-we-make-money.pdf | "No catch" proof |
| Source code | github.com/goodstrata/goodstrata | Apache-2.0, credibility, Show HN |

# GoodStrata — homepage motion-clip plan (code-built explainers, A/B tested)

_Five short explainer clips built in **code** (React + Remotion), not AI-generated video, with ElevenLabs en-AU voiceover and real Australian apartment/townhouse stills animated in-engine. They run muted-autoplay on the marketing homepage and funnel to the live fee-check and demo._

Last updated: 2026-07-03 · Owner: Jake (founder) · Status: v1 build brief
Grounds: `docs/MARKETING-PLAN.md` (§1.5 voice, §6 reels, §7 measurement) · `site/index.html` + `site/style.css` (tokens) · deploy: static assets via Cloudflare Worker `goodstrata-www`.

---

## Recommended stack (one line)

**Remotion (React) authored once per clip, rendered to MP4 + WebM + a poster JPG, embedded on the static homepage as a plain muted-autoplay `<video>` with burned-in captions — ElevenLabs en-AU VO baked in for the 9:16 social cut only; zero framework added to the marketing site.**

And the imagery call, up front: **hybrid, stock-first.** Buy/shoot a small kit of ~8 real Australian apartment/townhouse stills as the hero backgrounds (they carry the "this is your actual building" truth the whole wedge depends on), and use **Higgsfield `generate_image`** only for the harder-to-license or fully-synthetic frames (a de-glossed "city of small buildings" wide, an abstract noticeboard) — never for anything a viewer would read as a real, specific building. Details in §3.

---

## Why code, not AI video (the load-bearing constraints)

1. **The site stays a zero-framework static site.** It's served as static assets by a Cloudflare Worker (`deploy/site-worker`). We do **not** bolt React/Framer Motion onto it. Remotion runs at *build* time on our machine; the site only ever receives an encoded `<video>` + poster — ~0 added JS, hardware-decoded off the main thread, no CLS.
2. **The number on screen must match the page.** The homepage already ships a live vanilla-JS fee slider (`index.html:81–98`: `lots × $550` mgmt, `× $110` admin, `× $40` meetings, `× $700` total, en-AU formatted). The flagship clip animates the *same arithmetic* so video and page speak one language. Only code guarantees that fidelity — an AI-video generator would invent numbers.
3. **§1.5 voice is ours.** Autonomous agents that *do the work* · deterministic money · audit-first · free + open. Calm, plain, Australian. We do **not** echo StrataBot lines ("Take Back Control", "corruption-free"), don't lead with Four Corners, and never attack a fellow owner-led reformer. Captions and VO below are written to that rule.
4. **Deterministic-money credibility.** Real, readable UI (a ledger, a decision card, an append-only log) rendered from tokens beats a hallucinated "fintech dashboard" b-roll. The clips *are* the product's honesty.

---

## Shared production spine (applies to all five clips)

**One composition, two cuts.** Each clip is a single Remotion composition parameterised by `{ width, height, vo }`:
- **Homepage cut** — 16:9 master (1920×1080) + a 1:1 fallback (1080×1080). **Muted**, captions do all the talking, ends dissolving into the page's own `.btn.primary` eucalypt CTA so the clip hands off to the live tool with no seam.
- **Social cut** — 9:16 (1080×1920), same timeline, **ElevenLabs VO on**, for the §6 Meta/TikTok/Shorts program. Same source; a different `Sequence` crop + the audio track enabled.

**Palette — real tokens from `style.css` (light + dark, ship both, pick by `prefers-color-scheme`).**
| Token | Light | Dark | Use in clips |
|---|---|---|---|
| `--paper` | `oklch(0.982 0.003 95)` | `oklch(0.175 0.015 255)` | clip background |
| `--ink` | `oklch(0.21 0.035 260)` | `oklch(0.93 0.006 250)` | body captions |
| `--primary` (eucalypt) | `oklch(0.42 0.085 165)` | `oklch(0.78 0.09 165)` | CTAs, "$0", approve tap |
| `--critical` (oxide) | `oklch(0.54 0.19 27)` | `oklch(0.68 0.16 27)` | struck fee, "commission" line |
| **band** `--band-bg` / `--band-fig` | `oklch(0.3 0.052 165)` / `oklch(0.87 0.115 165)` | `oklch(0.235…)` / `oklch(0.85…)` | **every counting-number scene** — the site's "by the numbers" signature |

Rule: **all count-up figures render on the deep-eucalypt band with `--band-fig` numerals.** That band is the site's proof signature (`.proof-band`); reusing it makes the clips read as the same brand instantly.

**Type (self-hosted, same woff2 the site already preloads).**
- Headlines & captions: **Public Sans Variable**, weight 700, tracking `-0.02em`, sentence case, **no eyebrows/kickers** (matches the h1).
- **Every dollar figure, lot count, event count: IBM Plex Mono**, `font-variant-numeric: tabular-nums`. Mono = "this is a real number" across the whole site.
- Newsreader only for a single italic emphasis word if a scene wants it (mirrors the hero's `<em>shows its working</em>`, which the site renders upright in eucalypt — do the same: emphasis = colour, not slant).

**Motion grammar (consistent across all five):**
- Stills animate via **Ken Burns** (scale `1.0 → 1.08`, slow translate) + **parallax** (background still moves slower than foreground UI cards).
- UI elements enter with a **6px rise + fade** over 8–10 frames, spring settle. Fee cards **drop with a subtle thunk** (y overshoot). Count-ups use an ease-out over ~24 frames.
- **Captions**: bottom third, Public Sans 700, ink on a 92%-paper scrim, 1–7 words, swapped on scene cuts. Burned in (they carry the muted homepage cut).
- **30 fps**, 20–35s each. Shared 1.2s **end-card**: logo + URL on `--paper`, "free · open source · we don't store your file", dissolving into the live CTA button.
- **`prefers-reduced-motion`**: homepage embed shows the **poster frame** (a strong mid-clip still), no autoplay. Never animate for a visitor who opted out.

**Audio (social cut only).** One ElevenLabs en-AU narrator across all five (consistent voice = brand). Calm, plain, unhurried, never hypey. Light room-tone bed at ~-24 LUFS under VO; a soft "thunk" foley on fee-card drops. See §4.

---

## 1. The clip lineup — where each sits and where it funnels

| Clip | Source reel (§6) | Homepage slot | Funnels to | Priority |
|---|---|---|---|---|
| **C1 "The Number"** | Reel 1 (flagship) | Directly under the hero receipt slider (`index.html:58–80`) — dramatises the *same* number the slider shows | `/what-am-i-paying/` | **Ship first — 3 hook variants** |
| **C2 "The money is code"** | Reel 5 (trust) | Beside the "The money is code" band-card / how-it-works (`index.html:139–144`) | `demo.goodstrata.com.au` | 2nd |
| **C3 "One laptop"** | Reel 3 (proof) | Inside `.proof-band` (`index.html:213`) — matches the band it lives in | `/blog/announcing-goodstrata/` | 3rd |
| **C4 "Schedule B autopsy"** | Reel 2 | Inside the fee-check `section.alt` (`index.html:103`) | `/what-am-i-paying/` | 4th |
| **C5 "The handbook"** | Reel 4 (rally, softened) | Inside the "rally your building" section (`index.html:232`) | `/for-owners/` | 5th (own-channels; in-group with care) |

C1 is the A/B workhorse (three hook variants, §5). The rest ship single-variant once the C1 pipeline is proven.

---

## 2. The five clips — VO scripts, storyboards, imagery, captions, CTA

Imagery references pull from the **house kit** (§3): **A** Melbourne cream/red-brick 1970s walk-up (Fitzroy "six-pack"), **B** contemporary Melbourne/Sydney mid-rise apartment façade, **C** brick-and-Colorbond townhouse row, **D** a kitchen table with AGM papers (owner POV), **E** a suburban street of small blocks (the "84%" wide), **F** synthetic/abstract frames.

---

### C1 — "The Number" (FLAGSHIP) · ~28s · funnels to `/what-am-i-paying/`

**One-line brief:** the same arithmetic as the live slider, dramatised: base fee → hidden extras stack → the real total counts up → collapses to $0.

**VO (social cut), en-AU, calm — first line is the hook:**
> "Somewhere in your AGM papers is what your strata manager really costs you. The base fee is the number they show you. The extras — meeting fees, arrears notices, admin time — are the ones they don't. Plus a commission on your building's insurance you were never shown. So take a photo of the page, and drop it in. In seconds, the real number, in plain dollars. GoodStrata does that same admin with AI agents — free for your owners corporation. Agents do the work; you just decide. See your number. It's free."

| # | Caption (burned-in) | Visual (imagery + code motion) | VO beat |
|---|---|---|---|
| 1 | What does your strata manager actually cost you? | **D** — AGM pack thuds onto a kitchen table (still, Ken-Burns push-in); a hand-flip of dense figures composited as a masked wipe | "Somewhere in your AGM papers…" |
| 2 | The base fee is the number they show you | Cut to clean UI on `--paper`: a mono line `Base management fee … $6,600` rises in (the slider's `lots×$550` at 12 lots) | "The base fee is the number they show you." |
| 3 | + meeting fees + arrears notices + 'admin time' | Fee cards **drop and stack** like bricks over the base — `$1,320`, `$480` — each with a thunk | "The extras… are the ones they don't." |
| 4 | + insurance commission you were never shown | A greyed `Insurance commission … undisclosed` line lifts out of shadow in `--critical` (mirrors `.rl.comm`) | "Plus a commission… you were never shown." |
| 5 | Just take a photo of the page | **D** again: phone lifts, snaps the page; a clean upload spinner on a `--card` web UI | "So take a photo of the page, and drop it in." |
| 6 | $8,400 / year | On the **deep-eucalypt band**, the real total **counts up** to `$8,400` in `--band-fig` mono (the slider's `lots×$700`) | "In seconds, the real number, in plain dollars." |
| 7 | GoodStrata does the same admin. For $0. | Split: the struck `$8,400` (oxide line-through, like `.receipt-big.struck`) vs a clean eucalypt **`$0 /yr`** | "GoodStrata does that same admin… free for your owners corporation." |
| 8 | You still decide everything that matters | **B** apartment façade behind a calm decision card; a finger taps **Approve** (eucalypt glow) | "Agents do the work; you just decide." |
| 9 | goodstrata.com.au/what-am-i-paying | End-card: logo + URL on `--paper`; "free · open source · we don't store your file"; dissolves into the live `.btn.primary` | "See your number. It's free." |

**CTA:** "Drop your AGM in at goodstrata.com.au/what-am-i-paying — free, 30 seconds, we don't keep the file."
**A/B hook variants:** see §5 (the number, the phantom-notice line, the "84%" line).

---

### C2 — "The money is code" (trust / objection-killer) · ~24s · funnels to `demo.goodstrata.com.au`

**VO:**
> "The first thing everyone asks is whether you can trust an AI with the building's money. You shouldn't — so we didn't build it that way. The AI only drafts notices and suggests actions. Every dollar — levies, interest, reconciliation — is deterministic, tested code. If the AI turned to noise tomorrow, your levies would still add up to the cent. Anything that spends money waits for a person to approve it. And all of it lands on a log that even we can't edit. Try the live demo. Read every line. It's free."

| # | Caption | Visual | VO beat |
|---|---|---|---|
| 1 | "Trust an AI with our money?" | A skeptical comment bubble on `--paper`; **B** apartment façade soft behind | "The first thing everyone asks…" |
| 2 | You shouldn't. So we didn't. | Text flips confidently, eucalypt underline draws in | "You shouldn't — so we didn't…" |
| 3 | The AI only drafts and suggests | A card labelled **proposes** — greyed, no money icon; a faint "draft" watermark | "The AI only drafts… suggests actions." |
| 4 | The money is deterministic code | Cut to a real monospaced apportionment function (from GitHub), syntax on `--card` | "Every dollar… is deterministic, tested code." |
| 5 | If the AI broke, your levies still sum to the cent | On the band: an "AI" node glitches/dissolves while a `$ … balances to $0.00` ledger reconciles perfectly in `--band-fig` | "If the AI turned to noise tomorrow…" |
| 6 | Anything that spends money stops for a human | A decision card waits on **Approve**; a person taps it | "Anything that spends money waits…" |
| 7 | On a log not even we can edit | An append-only log scrolls, each row hash-stamped in mono | "…a log that even we can't edit." |
| 8 | Try it. Read the code. It's free. | End-card: logo + `demo.goodstrata.com.au` + GitHub | "Try the live demo… It's free." |

**CTA:** "See the demo, read the code → demo.goodstrata.com.au"

---

### C3 — "One laptop, one building, one decision" (proof) · ~24s · funnels to `/blog/announcing-goodstrata/`

Lives inside `.proof-band`, so this clip renders **entirely in band colours** — it should feel like the section it sits in coming alive. Numbers match the homepage stats exactly (`110` · `1` · `$0.00` · `~21k`).

**VO:**
> "We took a real twelve-lot walk-up in Fitzroy and ran a full month of management — on one laptop, with a local model. Arrears chased, correct to the cent. A roof leak triaged and a plumber dispatched — under a limit the code enforces. Minutes drafted without inventing a word. A hundred and ten actions, every one on a log you can read. And exactly one human decision the whole month. No money was ever computed by the AI. It's free, it's open source, and every transcript is published."

| # | Caption | Visual | VO beat |
|---|---|---|---|
| 1 | We ran a whole apartment building on this | **A** Fitzroy walk-up at dusk; pull back to one laptop glowing, terminal + clean UI | "We took a real twelve-lot walk-up…" |
| 2 | Arrears chased — correct to the cent | A ledger animates, balances reconcile to `$0.00` in `--band-fig` | "Arrears chased, correct to the cent." |
| 3 | Roof leak → triaged → dispatched | A repair card flows reported → dispatched under a code-enforced threshold line | "A roof leak triaged… under a limit the code enforces." |
| 4 | Minutes drafted — not a word invented | AGM minutes type out cleanly (typewriter reveal) | "Minutes drafted without inventing a word." |
| 5 | 110 audited events | Big **`110`** counts up on the append-only log | "A hundred and ten actions…" |
| 6 | 1 human decision. All month. | A single **Approve** tap glows | "…exactly one human decision the whole month." |
| 7 | $0.00 computed by an AI | Bold **`$0.00`**, then the code function behind it | "No money was ever computed by the AI." |
| 8 | Free. Open source. Read every line. | End-card: logo + GitHub + blog URL | "It's free, it's open source…" |

**CTA:** "Read every transcript → goodstrata.com.au/blog"

---

### C4 — "The Schedule B autopsy" · ~25s · funnels to `/what-am-i-paying/`

The wedge, dramatised: the tender-winning base fee, then the documented extras drop on top.

**VO:**
> "This is the fee your strata manager quoted to win the job. Then there's a charge for the meeting. And a fee for every arrears notice — even to chase a debt of a few cents. Six hundred dollars for a report a computer generated. A safety report that was really a recycled 2015 file. The headline fee was never the real fee. GoodStrata itemises every cent — and the money maths is open-source code, not a black box. See what you're really paying. It's free."

| # | Caption | Visual | VO beat |
|---|---|---|---|
| 1 | This is the fee that won the tender | A tidy `$400 / lot` card, green tick, on `--paper` | "This is the fee… to win the job." |
| 2 | $180 committee meeting | A fee card drops with a thunk | "Then there's a charge for the meeting." |
| 3 | $90 arrears notice × 34 | Cards stack faster; a red counter ticks up | "…even to chase a debt of a few cents." |
| 4 | $600 'automated' tax report | Card labelled 'automated report' lands | "Six hundred dollars for a report a computer generated." |
| 5 | $945 safety report (from 2015) | A dusty document with a '2015' stamp drops on | "…a recycled 2015 file." |
| 6 | $400 → $700+ | The stack collapses into one total on the band | "The headline fee was never the real fee." |
| 7 | The money is code, itemised | Cut to a clean GoodStrata ledger, every line itemised in mono | "GoodStrata itemises every cent…" |
| 8 | Free for your owners corporation | End-card: logo + fee-check URL | "See what you're really paying. It's free." |

**CTA:** "Find every fee like this in your own building → goodstrata.com.au/what-am-i-paying"

---

### C5 — "There was no handbook. So we built one." (rally, softened) · ~22s · funnels to `/for-owners/`

The §6 "Threat" reel, re-voiced to our own language (leads with the *handbook*, not the lobby's "threat" framing — safer in-group, still true). Own-channels first.

**VO:**
> "Most Victorian buildings are small — ten lots or fewer — and don't legally need a paid manager. Roughly four in ten already run themselves, quietly. There was never a DIY handbook for it. So we built one — that runs itself. Free for your owners corporation, open source, yours to keep. One motivated owner can move a whole building. Rally yours."

| # | Caption | Visual | VO beat |
|---|---|---|---|
| 1 | 84% of Victorian schemes are 10 lots or fewer | **E** suburban street of small blocks; small buildings light up one by one | "Most Victorian buildings are small…" |
| 2 | ~40% already run themselves | A share of the buildings turns eucalypt | "Roughly four in ten already run themselves." |
| 3 | There was no handbook | A blank noticeboard / empty shelf motif (**F**) | "There was never a DIY handbook for it." |
| 4 | So we built one — that runs itself | The GoodStrata dashboard resolves into view | "So we built one — that runs itself." |
| 5 | Free. Open source. Yours. | The one-pager PDF slides onto a **C** townhouse-row noticeboard | "Free… open source, yours to keep." |
| 6 | One owner can move a building | A hand pins the one-pager; neighbours gather (still, subtle parallax) | "One motivated owner can move a whole building." |
| 7 | goodstrata.com.au/for-owners | End-card: logo + URL | "Rally yours." |

**CTA:** "Rally your building → goodstrata.com.au/for-owners"

---

## 3. Imagery plan — **hybrid, stock-first** (recommended)

**The call: buy/shoot real stills for anything a viewer reads as a real building; use Higgsfield only for synthetic/abstract frames.** The wedge is "this is *your* actual building and *your* actual money" — photoreal-but-fake façades undercut that and carry a small but real "AI slop" credibility tax on a page whose whole pitch is honesty. Stock/self-shot Australian stills are cheap, unambiguous, and license-clean. Reserve generation for frames where no specific building is implied.

### House kit (8 stills, reused across all five clips for cohesion)

| Ref | Subject | Where used | Source & search terms |
|---|---|---|---|
| **A** | Melbourne cream/red-brick 1970s three-storey walk-up ("six-pack"), Fitzroy/Carlton | C1 sc.1, **C3 hero** | Stock: "Melbourne walk-up apartment brick", "Fitzroy six pack flats", "1970s cream brick flats Melbourne". Best self-shot (it's the case-study building's archetype). |
| **B** | Contemporary Melbourne/Sydney mid-rise apartment façade, balconies | C1 sc.8, C2 sc.1 | Stock: "modern apartment building facade Melbourne", "Australian apartment balconies daytime" |
| **C** | Brick-and-Colorbond townhouse row, suburban | C5 sc.5 | Stock: "Australian townhouse row Colorbond", "brick townhouses Melbourne suburb" |
| **D** | Kitchen table, AGM/strata papers, owner POV, morning light | C1 sc.1 & 5 | **Self-shoot** (cheapest, most authentic; also gives the phone-snap action). Stock fallback: "paperwork kitchen table Australian home", "reading documents at table overhead" |
| **E** | Suburban street of small apartment blocks, wide/aerial | C5 sc.1 | Stock: "Australian suburban apartment blocks aerial", "Melbourne suburb rooftops"; or Higgsfield if no clean license |
| **F** | Abstract: empty noticeboard, empty shelf | C5 sc.3 | **Higgsfield** `generate_image` (no real building implied) |

**Stock sources (AU-appropriate, license terms):**
- **Unsplash / Pexels** — free, commercial-OK, no attribution required. First stop for A/B/C/E. Verify each shot's license page; avoid recognisable people/plates.
- **iStock / Adobe Stock / Shutterstock** — paid royalty-free (~AUD $15–50/image or a small subscription) when Unsplash lacks a clean Australian-specific frame. Standard RF license covers web + social ads.
- **Self-shoot (D, and ideally A)** — a phone and 30 minutes. Zero license risk, maximum authenticity, and D needs the phone-snap motion anyway. Strongly preferred for the AGM-papers frames.

**De-gloss rule for any Higgsfield frame:** photoreal, overcast/soft daylight, no lens flare, no HDR punch, muted — must sit next to the real stills without looking rendered. Prompt scaffold:
> "Documentary photo, overcast soft daylight, [subject], Australian suburban context, muted natural colour, 35mm, no lens flare, no HDR, slight film grain, realistic, unstyled."

Run every generated frame past: *would a Melbourne owner believe this is a real photo?* If not, don't ship it.

**Legal:** no recognisable faces, number plates, or unit numbers without a release. Keep a one-line provenance note per asset (source + license) in the repo (`assets/CREDITS.md`).

---

## 4. ElevenLabs voiceover approach

- **One narrator, all five clips.** Pick a calm, warm **en-AU** voice (or clone one with `create_voice` for full control and consistency). Same voice = brand recognition across the reel program.
- **Delivery direction:** plain, unhurried, conversational — reads like a knowledgeable neighbour, not an ad. No upsell lift, no rhetorical "!". Slight downward inflection on the CTA line ("It's free.").
- **Settings:** stability ~55–60 (steady, not robotic), similarity ~80, style exaggeration low. Render at 48kHz, then normalise to **-16 LUFS** for social (platform target).
- **Pronunciation guards:** "levies" (LEV-eez), "strata" (STRAH-tuh, AU), "owners corporation" said in full, "AGM" as letters. Say dollar figures naturally ("eight thousand four hundred", not "eight-four-zero-zero").
- **Timing:** write VO to the storyboard, then let scene durations follow the VO (render audio first, measure, set `Sequence` lengths). The homepage muted cut ignores the audio track but keeps the *same timings* so captions land on the same beats.
- **Foley:** a soft "thunk" on each fee-card drop, a gentle tick on count-ups, a light room-tone bed at ~-24 LUFS. Keep it minimal — silence is on-brand.
- **Deliverables per clip:** `vo.mp3` (full narration) + per-line WAVs (so a re-cut doesn't re-render the whole track). Keep the exact script text in the repo beside the audio for reproducibility.

---

## 5. Homepage placement + A/B-test-and-measure plan

### Placement (respects the zero-framework constraint)

Each clip embeds as a self-contained block — a muted-autoplay `<video>` with `poster`, `playsinline`, `loop`, `preload="none"`, sized by the existing grid — dropped into the slot named in §1. No JS framework; a **~1KB IntersectionObserver shim** (vanilla, added to `nav.js` or a new `clips.js`) only (a) starts play when ≥50% in view, pauses when out, and (b) for `prefers-reduced-motion` or slow connections, shows the poster and never loads the video. Sources: WebM (VP9) first, MP4 (H.264) fallback; poster is a real mid-clip frame so there's no blank box and no CLS.

- **C1** under the hero receipt (`index.html:80`), directly tying the animated number to the live slider.
- **C2** beside the "money is code" band-card. **C3** *inside* `.proof-band`. **C4** inside the fee-check `section.alt`. **C5** in the rally section.
- Every clip's end-card dissolves into that section's existing eucalypt CTA — the video hands the viewer straight to the live tool.

### A/B test (C1 first — the workhorse)

**Three C1 hook variants** (scenes 2–9 identical; only the 0–3s hook + scene-6 number change):
- **V-A "The number":** opens on the AGM pack + "What does your strata manager actually cost you?" (baseline).
- **V-B "The phantom notice":** opens on "$101.48 — to chase a 60-cent debt." (the documented outrage hook from §3.4).
- **V-C "The 84%":** opens on "84% of Victorian buildings don't legally need a manager." (movement hook).

**How to split without a framework:** the clip block picks a variant on load via a tiny inline script — `Math.random()` bucketed, sticky per visitor in `localStorage`, variant id appended as a UTM (`?utm_content=c1-vA`) on that clip's CTA link. No A/B SaaS, no added weight, works on static hosting.

**Instrumentation (none is wired yet — stand this up in Week 1 per §7):**
- Fire two explicit events per clip: **`clip_watch_50`** (reached 50% of duration — the hook held) and **`clip_cta_click`** (CTA/end-card click). Tag both with `clip_id` + `variant`.
- The CTA already lands on `/what-am-i-paying/`; carry `utm_content` through so a **fee-check run** attributes back to the exact hook. Fee-check run is the north-star mid-funnel metric (§7).
- Lightweight, privacy-clean analytics (Cloudflare Web Analytics or a self-hosted Plausible-style beacon) — no cookies beyond the sticky variant id.

**Decision rule:** run until each variant has enough `clip_watch_50` for signal; **rank by fee-check-runs-per-view** (not raw views). The winning hook is the one promoted into Phase 3 paid (§4/§7 of the marketing plan). Kill any clip whose CTA doesn't fire a fee-check-run or demo-start.

**Success metrics tie-in (§7):** 3-sec hook hold → `clip_watch_50` → `clip_cta_click` → **fee-check run** → demo start. Report weekly; the hook winner feeds paid.

---

## 6. End-to-end build plan for C1 + repo layout

**Where it lives:** a new, isolated workspace in the monorepo that renders to files — it never ships as a runtime dependency of the site.

```
apps/motion-clips/                 # pnpm workspace, Remotion project (build-time only)
  package.json                     # remotion, @remotion/cli, react; NOT referenced by site-worker
  remotion.config.ts               # 30fps, H.264 + VP9 output
  src/
    Root.tsx                       # registers compositions (C1 16:9, 1:1, 9:16) via <Composition>
    theme.ts                       # the style.css tokens as JS consts (paper/ink/primary/critical/band…)
    lib/
      useCountUp.ts                # ease-out interpolate() count-up (matches slider arithmetic)
      FeeCard.tsx                  # the drop-with-thunk fee brick
      Caption.tsx                  # burned-in Public Sans caption w/ paper scrim
      EndCard.tsx                  # shared logo + URL + dissolve-to-CTA
      KenBurns.tsx                 # still + scale/translate wrapper
    clips/
      C1TheNumber.tsx              # the 9-scene timeline; props: {width,height,vo,hook:'A'|'B'|'C'}
    assets/
      img/  (A_walkup.jpg, B_facade.jpg, D_table.jpg …)   # the §3 kit
      fonts/ (symlink or copy of site/fonts woff2)
      audio/ (c1_vo.mp3, thunk.wav, roomtone.wav)
    CREDITS.md                     # per-asset source + license (§3 legal)
  out/                             # rendered artefacts (git-ignored)
    c1-vA-16x9.{webm,mp4}  c1-vA-16x9.jpg (poster)  c1-vA-9x16.mp4 …
```

**Then wire into the static site (no framework):**
```
site/
  clips/                          # copied render outputs the Worker serves as static assets
    c1-vA-16x9.webm / .mp4 / .jpg
    c1-vB-… c1-vC-…
  clips.js                        # ~1KB: IntersectionObserver play/pause + reduced-motion poster + variant pick + event beacons
  index.html                      # add the <video> block under the hero receipt (line ~80)
```

**Build steps for C1 (concrete order):**
1. **Scaffold** `apps/motion-clips` with Remotion; load the **`remotion-best-practices` skill** before writing components. Copy the four woff2 from `site/fonts/`; port tokens into `theme.ts` (both light + dark).
2. **Lock the VO** — generate `c1_vo.mp3` with the chosen en-AU ElevenLabs voice (§4), measure the timing of each line; that sets each scene's frame length.
3. **Source imagery** — self-shoot **D** (AGM papers + phone snap), pull **A/B** from Unsplash (verify license into `CREDITS.md`); de-gloss any generated frame per §3.
4. **Build the composition** — 9 scenes; scene 6 count-up must reproduce the slider maths (`lots×$700` at 12 lots = `$8,400`) so the clip and page agree to the dollar. Parameterise `hook` for V-A/B/C.
5. **Render** all cuts: 16:9 + 1:1 (muted, homepage) and 9:16 (VO on, social), each as WebM + MP4 + a poster JPG, per hook variant.
6. **Embed** — add the `<video>` block + `clips.js` to `index.html` under the hero receipt; verify muted-autoplay, poster on reduced-motion, no CLS, and that the CTA carries `utm_content=c1-v*`.
7. **Instrument** — fire `clip_watch_50` + `clip_cta_click` with `clip_id`/`variant`; confirm fee-check-run attribution end-to-end.
8. **Ship + measure** (§5), pick the hook, then reuse the exact spine to produce C2–C5 single-variant.

---

## Quick reference (for the orchestrator)

- **File:** `/Users/jake/Projects/open-goodstrata/docs/MOTION-CLIPS-PLAN.md`
- **Recommended stack (one line):** Remotion (React) authored once per clip → rendered to MP4 + WebM + poster → embedded on the static homepage as a muted-autoplay `<video>` with burned-in captions and ElevenLabs en-AU VO on the 9:16 social cut; zero framework added to the site.
- **Flagship clip:** **C1 "The Number"** — first VO line: *"Somewhere in your AGM papers is what your strata manager really costs you."*
- **Imagery recommendation:** **hybrid, stock-first** — real Australian stills (Unsplash/paid RF/self-shot) for anything read as a real building; Higgsfield `generate_image` only for synthetic/abstract frames, de-glossed to sit beside the photos.

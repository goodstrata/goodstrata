# GoodStrata Design System — “The Registry”

> An owners corporation’s records used to live in a minute book on a shelf.
> GoodStrata is that book, kept by machines. The interface reads as a
> beautifully kept civic register: calm paper surfaces, ink text, one deep
> institutional green, and provenance set in mono.

This document is normative. Every screen in `apps/web` follows it. When a new
surface is added, it is designed from these tokens and patterns — not from
component defaults.

---

## 1. Principles

1. **On the record.** The platform’s promise is that every action is evented
   and auditable. The UI expresses that: identifiers, amounts, event types,
   and timestamps are set in the registry mono. Human actions and agent
   actions are visually distinguishable everywhere they appear.
2. **Calm authority.** This is people’s homes and money. No gradients shouting,
   no dashboard confetti. Hairline borders, generous whitespace, one accent
   used with intent.
3. **Phone-first governance.** Owners approve levies and vote from a phone.
   Every flow works one-handed at 360 px before it is considered done at
   1440 px.
4. **States are designed, not defaulted.** Loading, empty, and error states are
   first-class: an empty register is an invitation to act, an error says what
   happened and what to do next.
5. **Words are UI.** Sentence case. Plain verbs. Buttons say what they do
   (“Record payment”, not “Submit”). The same action keeps the same name from
   button to toast.

## 2. Identity

- **Mark:** the stacked strata-plates logo (layered floor plates). Ink on
  paper, paper on ink. The stacked-planes motif may appear as a ghost glyph in
  empty states and the auth screen — nowhere else.
- **Signature element — the Registry Plate:** the scheme header is rendered as
  a nameplate, like brass at a building entrance: a mono identifier line with
  the plan of subdivision and tier (`PS 543921K · Tier 2`), the scheme name in
  bold display type beneath, a hairline rule under both with a three-stroke strata motif
  at its left end. A compact variant appears on dashboard scheme cards. This
  is the one memorable flourish; everything around it stays quiet.

## 3. Color

All tokens are `oklch`. Semantic tokens only in application code — raw Tailwind
palette classes (`text-green-700`, `bg-purple-50`…) are banned in `src/`
outside `styles.css`.

### 3.1 Core — light (“day”)

| Token | Value | Use |
| --- | --- | --- |
| `--background` (paper) | `oklch(0.982 0.003 95)` | app canvas |
| `--card` | `oklch(1 0 0)` | raised surfaces |
| `--foreground` (ink) | `oklch(0.21 0.035 260)` | text; matches the logo’s slate ink |
| `--muted` | `oklch(0.955 0.005 250)` | quiet fills |
| `--muted-foreground` | `oklch(0.50 0.02 255)` | secondary text |
| `--border` | `oklch(0.905 0.008 250)` | hairlines |
| `--primary` (eucalypt) | `oklch(0.42 0.085 165)` | actions, links, active nav |
| `--primary-foreground` | `oklch(0.982 0.003 95)` | text on primary |
| `--accent` | `oklch(0.955 0.02 165)` | selected/hover tints |
| `--accent-foreground` | `oklch(0.32 0.07 165)` | text on accent |
| `--destructive` (oxide) | `oklch(0.54 0.19 27)` | destructive actions, critical |
| `--ring` | `oklch(0.55 0.09 165)` | focus |

### 3.2 Core — dark (“after hours”)

Deep bluestone, never pure black. Eucalypt brightens; ink and paper swap roles.

| Token | Value |
| --- | --- |
| `--background` | `oklch(0.175 0.015 255)` |
| `--card` | `oklch(0.215 0.018 255)` |
| `--foreground` | `oklch(0.93 0.006 250)` |
| `--muted` | `oklch(0.26 0.018 255)` |
| `--muted-foreground` | `oklch(0.68 0.015 252)` |
| `--border` | `oklch(0.31 0.02 255)` |
| `--primary` | `oklch(0.75 0.09 165)` (foreground: ink `oklch(0.18 0.03 260)`) |
| `--accent` | `oklch(0.28 0.03 170)` (foreground: `oklch(0.85 0.07 165)`) |
| `--destructive` | `oklch(0.62 0.17 27)` |
| `--ring` | `oklch(0.70 0.09 165)` |

Dark mode is a real mode: `next-themes` class strategy, toggle in the account
menu, `theme-color` meta follows.

### 3.3 Status tones

One systematic scale replaces every hardcoded badge color. Each tone defines
`bg / fg / border` pairs per theme (`--tone-<name>-*`):

| Tone | Hue | Meaning | Examples |
| --- | --- | --- | --- |
| `positive` | eucalypt | good standing, completed | active, paid, passed, joined, closed (resolved) |
| `caution` | ochre `oklch(0.62 0.13 80)` | needs attention, in flight | pending, awaiting quorum, invited, draft levy |
| `critical` | oxide | wrong, overdue, refused | overdue, failed, rejected, cancelled |
| `info` | bluestone-blue `oklch(0.52 0.06 250)` | neutral fact | scheduled, tier, categories |
| `agent` | patina `oklch(0.55 0.075 195)` | done by a machine | agent actor chips, AI Chair, automation |
| `neutral` | bluestone grey | everything else | archived, unknown |

**Provenance rule:** anything performed by an agent is marked with the patina
tone (dot, chip, or icon) wherever it appears — activity feed, chair log,
decisions, notifications. Human actors are ink. This is the trust system made
visible; do not repurpose patina for anything else.

## 4. Typography

| Role | Face | Usage |
| --- | --- | --- |
| Display | **Newsreader** (variable, opsz+wght 500–600) | page titles, the Registry Plate, auth headline, big figures on stat cards. Restraint: never below 20 px, never for body or labels. |
| UI / body | **Public Sans** (variable) | everything else. 14 px body, 13 px secondary, 16 px on mobile inputs (prevents iOS zoom). |
| Registry mono | **IBM Plex Mono** (400/500/600) | money, lot numbers, plan numbers, event types, seq numbers, timestamps in feeds, CSV/code. Always `tabular-nums`. |

Self-hosted via Fontsource (`@fontsource-variable/newsreader`,
`@fontsource-variable/public-sans`, `@fontsource/ibm-plex-mono`). Tokens:
`--font-display`, `--font-sans`, `--font-mono`.

Type scale (rem): 0.75 / 0.8125 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25.
Page title = `display 1.75/2.25`, card title = `sans 1rem/600`, small label =
`sans 0.75rem/500 muted`. Hierarchy is carried by size and weight — no
mono-uppercase eyebrows; mono is reserved for figures and registry identifiers.

## 5. Shape, depth, motion

- **Radius:** `--radius: 0.5rem`. Controls `md`, cards `lg`, plates/sheets `xl`.
- **Depth:** hairline borders carry structure; shadows are whispers
  (`shadow-xs` on cards, `shadow-lg` only on overlays). Paper does not glow.
- **Motion:** 150–200 ms ease-out. Overlays fade+scale (radix defaults);
  list/feed items fade+2 px rise. New live events flash their left dot once.
  Everything honors `prefers-reduced-motion` (`motion-reduce:` variants).

## 6. Layout & navigation

Breakpoints designed at **360 / 768 / 1024 / 1440**.

### 6.1 App shell

- **≥ lg:** slim top bar (logo, notifications, account) + **left sidebar
  (16 rem)** inside a scheme. Sidebar groups the eleven sections as a
  register index:
  - Overview
  - **Money** — Finance
  - **Building** — Maintenance
  - **Governance** — Meetings, Decisions, Committee
  - **Register** — Lots, People, Documents, Activity
  - **Automation** — Agents
  Active item: eucalypt text + accent fill + 2 px left rule. Role-gated items
  simply don’t render.
- **< lg:** top bar gains the scheme name (truncated); navigation moves to a
  **bottom tab bar** — Overview, Finance, Meetings, Activity, **More** — where
  More opens a sheet listing all sections in the same groups. Bottom bar is
  `position:fixed`, 64 px + safe-area inset, 44 px minimum touch targets,
  labels always visible. Main content gets matching bottom padding.
- Tab state lives in the URL (`?section=finance`, validated search param).
  Deep links and back button work; e2e selects sections via the nav’s
  accessible names.
- Skip link, `<nav aria-label>`s, focus-visible everywhere.

### 6.2 Page anatomy

Every section page: optional Registry Plate (scheme hub) → `PageHeader`
(title, one-line purpose, primary action right / stacked on mobile) → content.
Content max-widths are standardized: prose/forms `max-w-2xl`, registers
`max-w-4xl`, full tables `max-w-none`. No per-tab ad-hoc widths.

## 7. Components

Foundation is the existing shadcn/radix kit, extended. New primitives live in
`src/components/ui/`; composite patterns in `src/components/`.

### 7.1 New primitives

- **`Field`** — label + control + hint + error slot. Wires `htmlFor`,
  `aria-invalid`, `aria-describedby`. Error line: 13 px oxide with a 3.5
  circle-alert icon. Required fields marked in the label.
- **`LoadingButton`** (`Button` extension) — `pending` prop renders spinner +
  keeps width; disabled while pending.
- **`EmptyState`** — ghost strata glyph or lucide icon, title, one sentence,
  optional action. Replaces every dashed-border `<p>`.
- **`ErrorState`** — what happened + “Try again” wired to `refetch`.
- **`PageHeader`** — title/description/actions, responsive.
- **`RegistryPlate`** — the signature scheme header (full + compact).
- **`StatCard`** — mono-set figure (display serif for hero figures), label,
  optional tone + delta. Used on Finance and dashboard.
- **`SidebarNav` / `BottomNav` / `SectionSheet`** — the shell navigation.
- **`ResponsiveTable`** — `<Table>` from `md:` up; stacked definition cards
  below. Column defs supplied once.
- **`Money`** — formats cents, Plex Mono `tabular-nums`, right-aligned in
  tables, negatives in oxide with a proper minus.

### 7.2 Upgraded conventions

- `StatusBadge` maps every domain status to a **tone** (single source of
  truth), never to raw colors.
- `Badge` gains `tone` variants matching §3.3.
- Dialogs: max-height `85dvh`, internal scroll, full-width buttons on mobile.
  Any dialog with > 2 fields becomes a **Sheet** (side `right` on desktop,
  `bottom` on mobile).
- Toasts: success only (“Levy run created”); errors render inline next to the
  form’s submit, never only as a toast.

## 8. Forms

**Stack:** `@tanstack/react-form` + zod v4 (workspace catalog), via a thin
`useAppForm` wrapper.

- **Validation timing:** `revalidateLogic()` — quiet until first submit, live
  after. No yelling while typing.
- **Schemas:** colocated `z.object` per form; messages are human (“Enter the
  amount in dollars, like 250.00”), not zod defaults.
- **Server errors:** rendered in a `FormError` region above the submit button;
  field-level 422s map onto fields when the API provides them.
- **Submission:** buttons show pending state; inputs disable; success toasts
  and invalidates queries; forms reset only on success.
- **Mobile:** inputs ≥ 16 px font, correct `inputMode`/`autoComplete`,
  `enterKeyHint`.

Every mutation in the app goes through this pattern — no bare
`useState`+`disabled={!value}` forms remain.

## 9. Data display

- **Money** is always cents-integer in, `Money` component out. Never float
  math in the UI.
- **Dates:** `formatDate` (“12 Mar 2026”), `formatTime` for feeds; relative
  (“2 h ago”) only in notifications, with title tooltip of the absolute.
- **Registers (tables):** hairline rows, mono for numerics, first column
  medium weight. On mobile they become stacked cards via `ResponsiveTable` —
  horizontal scroll is a last resort reserved for genuinely tabular finance
  data, and then with edge fade + `-webkit-overflow-scrolling`.
- **Feeds (activity, chair log):** left rule timeline, dot colored by actor
  provenance (ink = human, patina = agent), event type in mono, seq + time
  right-aligned mono.

## 10. Accessibility floor

Non-negotiable on every surface: WCAG AA contrast in both themes; visible
focus (`ring` token); 44 px touch targets in navigation and bottom bar; all
inputs labelled (no placeholder-as-label); dialogs/sheets trap focus and
restore it (radix); status conveyed by text or icon as well as color; feeds
use `aria-live="polite"`; `lang="en-AU"` and Australian spelling in copy.

## 11. Voice

- Sentence case everywhere, including buttons and nav.
- Australian strata vocabulary, used precisely: *owners corporation, lot, plan
  of subdivision, levy, special resolution, quorum, certificate of currency,
  office holder*.
- Agents are named plainly (“the levy agent recorded this”), never cutesy.
- Empty states invite (“No levy runs yet — create the first annual budget
  run.”); errors explain and point forward; nothing apologises.

## 12. Heritage & contracts

- The launch site’s identity (slate ink, uppercase kickers, stat blocks,
  proof-led density) carries into the app as ink foreground, mono figures,
  `StatCard`, and evidence-bearing feeds. Its stock Tailwind blue-700 is
  retired in favour of eucalypt; the marketing site follows in a later pass.
- **Status text contract:** status badges keep the raw lowercase domain word
  in the DOM (`adopted`, `paid`, `open`) and capitalise visually with CSS —
  the e2e suite asserts exact lowercase strings.
- **Single-instance DOM:** responsive variants swap via `useIsMobile`, never
  by rendering duplicate hidden/`md:block` interactive elements (Playwright
  strict mode counts them).
- **Server field errors:** the API’s 422 envelope carries zod issues in
  `error.details`; the api client exposes them (`ApiError`) and `useAppForm`
  maps them onto fields.

## 13. Enforcement

- Raw palette classes and hex colors in `src/` are lint-visible code smells;
  tones and tokens only.
- New forms must use `useAppForm` + `Field`.
- New status values must be added to the `StatusBadge` tone map — unmapped
  statuses render `neutral` and log in dev.
- A change is not “responsive-done” until exercised at 360 px.

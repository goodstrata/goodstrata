# C1 asset provenance

v1 renders **no licensed photos** — the two "imagery" scenes are intentional
code-built brand treatments (see plan §C1 sc.1 / sc.8):

- **sc.1** — stylised AGM "Statement of Fees & Charges" card (`src/lib/AgmCard.tsx`)
  with a Ken-Burns push-in on a soft paper vignette. Figures are illustrative
  and consistent with the homepage slider (12 lots).
- **sc.8** — an Approve decision card on a soft eucalypt gradient with faint
  façade mullions (`Scene8` in `src/clips/C1TheNumber.tsx`).

Both `KenBurns` usages accept an optional `src` prop: a v2 will drop in real
licensed AU apartment/townhouse stills (kit refs A/B/D per plan §3) with a
one-line source + license note added here per asset.

Fonts: Public Sans, Newsreader, IBM Plex Mono (OFL) — copied from `site/fonts/`.

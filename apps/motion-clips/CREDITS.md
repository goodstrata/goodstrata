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

## Music

Both music beds are **original compositions synthesized from scratch** by
`scripts/make-music.py` (numpy additive synthesis — no samples, no stock or
licensed music, nothing pre-existing):

- `public/audio/music-clips.mp3` — warm D-major felt-piano/pad bed under the
  C1–C5 explainers (`MusicBed` volume 0.15 ≈ 11 dB under the VO).
- `public/audio/music-ads.mp3` — punchier B-minor pulse bed under the AD1–AD4
  verticals (`MusicBed` volume 0.22 ≈ 8 dB under the VO).

The script is deterministic (fixed seed); rerun it to regenerate the beds
bit-identically.

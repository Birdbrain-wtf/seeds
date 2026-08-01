# Identity Forest

The visual layer of **Seeds** (Birdbrain's Proof-of-Personhood + sensemaking).

Each **Seed** (a person's witnessed contribution record in `vault/seeds/`)
becomes a generative **organism**:

- **branches** = topics they've contributed to (length = how many sessions on that topic, colour = hash of the topic)
- **core** = total Chaos-Session attendance (bigger = more present)
- **gold dots** = open action items
- **solidity** = record confidence (high/medium/low)
- unrecorded people render as faint **seedlings** (honest gap nodes — never faked)

Organisms are linked by **co-attendance**: two people who sat in the same session
share an edge, weighted by how many sessions they shared. That edge set is the
web of relationships the Seeds thesis is about.

## Build

```bash
bun run identity-forest/scripts/build.ts
```

- **Input** — `vault/seeds/*.md` (frontmatter + "## Topic profile" body). Read-only.
- **Output** — `identity-forest/out/`: `forest.svg` (static render),
  `index.html` (**the living page** — see below), `forest.json` (nodes + genome +
  co-attendance edges), `organisms/<slug>.svg` (one per Seed), `forest.png`
  (auto-rasterised via `rsvg-convert` when available; used for OG cards).

## The living page (`out/index.html`)

`scripts/page.ts` emits a self-contained interactive page (after Jonathan
Harris's *We Feel Fine* — data as something alive). The client only **draws**:
all geometry (layout, rotations, hues) is precomputed deterministically
server-side and shipped inline as `DATA`; no fetches beyond web fonts, no
analytics, no randomness. Interactions:

- organisms **breathe and sway** (per-slug deterministic phase; disabled under `prefers-reduced-motion`)
- **hover** a person → their web lights in their aura hue, everyone unconnected fades; whisper caption
- **click** → their seed card: vitals, an italic "poem" derived from the record, topic threads, strongest ties (clickable — walk the graph)
- **topic lens** — chips light one thread across the whole forest, everyone else recedes
- **ticker** — true sentences generated from the record, cycling
- **find yourself** — search flies the viewport to your organism and opens your card
- pan / wheel-zoom / double-click reset

## The dimension ladder (1D · 2D · 3D · 4D)

The same record told in progressively more dimensions — an experiment in how
narrative flattens or opens depending on how many axes you allow it (keys 1–4):

- **1D — the line.** Everyone reduced to one number (presence), beads on a single
  axis; relationships forced to arc overhead. Shows what a ranking costs.
- **2D — the plane** (default). The SVG night forest above.
- **3D — the space.** The plane is revealed as the flat-on view of a 3D volume
  whose **depth axis is topical**: a deterministic spectral embedding
  (`topicalDepth()` in build.ts — power iteration over person↔topic vectors,
  rank-spread, no randomness) places people who carry similar threads at similar
  depth. Orbit/dolly camera, billboarded canvas sprites, idle auto-orbit.
- **Stand with them** — from a person's card in 3D/4D, the camera moves to just
  behind their position, looking at the room: their own organism ghosts out (you
  don't see yourself), their companions stand nearest, their threads radiate in
  their aura. The relativist point made literal: the room looks different from
  every seat. `↩ step back` restores your own view.
- **4D — time.** The 26 Chaos Sessions played through the space: organisms
  appear at first attendance and grow with accumulated presence, threads thicken
  as shared sessions accrete, flow-particles run along the current session's
  edges. Play / scrub timebar.

1D/3D/4D render on a `<canvas>` (organisms pre-rendered once as sprites, then
stamped with perspective scaling); 2D remains the original SVG. All positions,
depths and session indices are precomputed in `build.ts` and shipped in `DATA`
— the client still only draws.

## Published

Live + public at **https://rw.zo.space/seeds/forest** (page route iframes
`/raw/forest`, an API route that reads `out/index.html` off disk — a living
document: re-running the build refreshes the live page, no redeploy).

## Trust posture

**Zero-trust.** Pure, deterministic function of PUBLIC Seed data — no keys, no
network, no model, no `Math.random` (all jitter is seeded from the slug, so a
given corpus always renders identically). See [`TRUST.md`](../TRUST.md) at the repo root.

## Notes

- Naming: this is a Birdbrain surface; keep other brand names off it.
- The render exposes duplicate/near-duplicate Seeds in the corpus (e.g. two
  `Josep`, `michiel` vs `michiel-heij`) — that is a Seed-dedup data-hygiene task,
  not a render bug.

# Seeds

**Identity that emerges from witnessed participation.**

Seeds is [Birdbrain](https://rw.zo.space/birdbrain)'s Proof-of-Personhood and
sensemaking layer. Instead of proving personhood by surveilling behaviour
(writing-style fingerprints, biometrics, behavioural classifiers), a **Seed** is
a *witnessed contribution record*: who was actually present, what they carried
into the room, who they sat beside, what they committed to — derived from real
sessions, bound (by its owner, not by us) to a self-custody key.

**Live demo:** https://rw.zo.space/seeds/forest — the Identity Forest, a
deterministic render of a real community's Seeds in 1D / 2D / 3D / 4D.

## The thesis

- **Personhood is relational.** You are evidenced by the web of people who have
  actually worked beside you, not by a classifier's opinion of your prose.
- **Pseudonymity is a feature, not an attack.** One person, many faces: the
  canonical Seed stays bound to the person's own keys, while alter egos and
  anonymous contributions remain possible — linkable back only by the person
  themselves. Sybil-resistance comes from weight flowing through *witnessed,
  real participation*, never from forbidding multiple identities.
- **Honest gaps, never faked.** People present in the room but thin in the
  record render as gaps, not fabrications.

## The pipeline

```
session transcripts
      │
      ▼
seed-builder/          extract.py    → structured YAML per session (LLM-assisted)
                       distribute.py → vault/seeds/<person>.md   (the Seed records)
                                       vault/concepts/<slug>.md  (shared concepts)
                                       _edges.yaml/.json         (typed graph edges)
      │
      ▼
participation-graph/   build.ts      → graph.json + by-seed.json (seed↔seed edges, per-seed inbox)
      │
      ▼
identity-forest/       build.ts      → forest.svg/json + index.html (the living page)
```

Each stage is deterministic, re-runnable, and read-only over its sources.
A Seed record is plain Markdown with YAML frontmatter — legible, portable,
owned by the community that generated it.

## Components

| Dir | What | Trust posture |
| --- | --- | --- |
| `seed-builder/` | Turns witnessed sessions into per-person Seed records, shared concepts and typed graph edges | trust-minimised — open, deterministic, verifiable from the record |
| `participation-graph/` | Folds comments/replies/mentions/endorsements into a seed-to-seed edge graph + per-seed inbox | trust-minimised |
| `identity-forest/` | Renders the Seeds as a generative forest — organisms, relationships, dimensions, time | zero-trust — pure function of public Seed data; no keys, no model, no randomness |

The full trust model — including the one permitted custody exception and the
retired-by-design surveillance approach — is in [`TRUST.md`](TRUST.md).

## Running it

Requirements: [Bun](https://bun.sh) (TypeScript stages), Python 3.11+ with
`pyyaml` and `aiohttp` (builder stages).

```bash
# 1. Build Seed records from extracted session YAML
python3 seed-builder/distribute.py            # reads $SEEDS_VAULT (default ./vault)

# 2. Build the participation graph
bun run participation-graph/scripts/build.ts  # reads $COMMENT_ROOT, writes $PARTICIPATION_OUT

# 3. Grow the forest
bun run identity-forest/scripts/build.ts      # reads $SEEDS_DIR (default ./vault/seeds), writes identity-forest/out/
```

`extract.py` (transcript → structured YAML) calls an LLM over HTTP; by default
it targets the maintainers' endpoint — point it at your own by editing the
constants at the top. Everything downstream of extraction is model-free.

## Provenance

This repo is the open-sourced Seeds stack from the Birdbrain project, exported
from the live workspace where it runs daily against a real community's sessions
(26 sessions, ~46 Seeds at time of writing). It is working software, not a
specification. Licensed Apache-2.0.

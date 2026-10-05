# Seeds

**Identity that emerges from witnessed participation.**

Seeds is [Birdbrain](https://birdbrain.wtf)'s Proof-of-Personhood and
sensemaking layer. Instead of proving personhood by surveilling behaviour
(writing-style fingerprints, biometrics, behavioural classifiers), a **Seed** is
a *witnessed contribution record*: who was actually present, what they carried
into the room, who they sat beside, what they committed to — derived from real
sessions, bound (by its owner, not by us) to a self-custody key.

**Live demo:** https://birdbrain.wtf/seeds/forest — the Identity Forest, a
deterministic render of a real community's Seeds in 1D / 2D / 3D / 4D.

## The thesis

- **Personhood is relational.** You are evidenced by the web of people who have
  actually worked beside you, not by a classifier's opinion of your prose.
- **Pseudonymity is a feature, not an attack.** One person, many faces: the
  canonical Seed stays bound to the person's own keys, while alter egos and
  anonymous contributions remain possible — linkable back only by the person
  themselves. Sybil-resistance comes from weight flowing through *witnessed,
  real participation*, never from forbidding multiple identities. Faces
  contribute; only the Seed holds a membership and a vote.
- **Honest gaps, never faked.** People present in the room but thin in the
  record render as gaps, not fabrications.

## The layers

Seeds is one design carried down through several layers. Each layer does one thing and hands it to the next one, and no layer redoes another's work.

| Layer | Where | What it does | Runs today |
| --- | --- | --- | --- |
| Evidence | [`seed-builder/`](seed-builder) | Turns witnessed sessions into per-person Seed records, shared concepts and typed graph edges | Daily, against a real community's sessions |
| Relationships | [`participation-graph/`](participation-graph) | Folds comments, replies, mentions and endorsements into a seed-to-seed graph and a per-seed inbox | Yes |
| Rendering | [`identity-forest/`](identity-forest) | Draws the Seeds as a generative forest, a pure function of the public record | Yes, at the live demo |
| Settlement | [`chain/`](chain) | A chain with one job: members admit people against that evidence, new units appear only when a point holds up, and members vote on its rules | Lab, a three-node network |
| Execution, next | [Jambo](https://github.com/Birdbrain-wtf/jambo), its own repo | A reduced JAM client that runs the same rules as small services. Its first is the member register | Lab, a six-validator demo |

```
session transcripts
      │
      ▼
seed-builder/          extract.py    → structured YAML per session (LLM-assisted)
                       distribute.py → vault/seeds/<person>.md   (the Seed records)
                                       vault/concepts/<slug>.md  (shared concepts)
                                       _edges.yaml/.json         (typed graph edges)
      │
      ├──▶ participation-graph/   build.ts → graph.json + by-seed.json
      │          │
      │          ▼
      │    identity-forest/       build.ts → forest.svg/json + index.html
      │
      ▼
chain/                 witness · record · mint · vote · seat validators
      ┆
      ┆   the same rules, ported a service at a time
      ▼
jambo                  (separate repo)
```

The first three stages are deterministic, re-runnable, and read-only over their sources. A Seed record is plain Markdown with YAML frontmatter, so it stays legible and portable, and it belongs to the community that produced it.

## One set of rules, every layer

| Rule | Off the chain | On the chain | In Jambo |
| --- | --- | --- | --- |
| You are evidenced by people who were there | A Seed is built from sessions you actually attended | Admission takes two members naming the same session evidence | Next: refine checks two members' signatures |
| Your key is yours | The Seed binds to a key you hold | The member key comes from your own passkey. Only members can sign | Next: only a member's signature can get work onto a core |
| New units only where something held up | | Minted when an unchallenged point matures, nowhere else. Joining mints nothing | Next: a unit ledger inside the service, separate from JAM's own balances |
| One member, one vote | | Upgrades and founding control are decided by members | Next: members vote on the service's code. JAM itself sits outside that vote |
| Gaps stay gaps | Someone thin in the record renders as a gap, never a guess | | |

Where a cell is empty, that layer has nothing to say about the rule. [`TRUST.md`](TRUST.md) says what each component is trusted with and why.

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

# 4. Run the chain and walk every job on it (Rust, ~12 minutes once built)
bash chain/scripts/e2e.sh
```

`extract.py` (transcript → structured YAML) calls an LLM over HTTP; by default
it targets the maintainers' endpoint — point it at your own by editing the
constants at the top. Everything downstream of extraction is model-free.

## Provenance

This repo is the open-sourced Seeds stack from the Birdbrain project, exported
from the live workspace where the first three layers run daily against a real
community's sessions (36 sessions and 57 Seeds at the time of writing). The chain
is lab code that has run as a three-node network. It is working software, not a
specification. Licensed Apache-2.0.

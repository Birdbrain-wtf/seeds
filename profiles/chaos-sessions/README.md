# The Chaos Sessions profile

A weekly open call. People come because it is interesting, nobody is paid to attend, and the protocol runs as part of belonging to it. This is the group whose sessions produced the first Seeds, and this folder is its tooling: how a session becomes a record, how the records connect, and how they are drawn.

None of it is the protocol. Another group would keep its own records in its own way and run the same chain.

| Layer | Folder | What it does |
| --- | --- | --- |
| Evidence | [`seed-builder/`](seed-builder) | Turns session transcripts into per-person Seed records, shared concepts and typed edges |
| Relationships | [`participation-graph/`](participation-graph) | Folds comments, replies, mentions and endorsements into a seed-to-seed graph and a per-seed inbox |
| Rendering | [`identity-forest/`](identity-forest) | Draws the Seeds as a generative forest, a pure function of the public record. Live at [birdbrain.wtf/seeds/forest](https://birdbrain.wtf/seeds/forest) |

```
session transcripts
      │
      ▼
seed-builder/          extract.py    → structured YAML per session (a language model, your choice)
                       distribute.py → vault/seeds/<person>.md   (the Seed records)
                                       vault/concepts/<slug>.md  (shared concepts)
                                       _edges.yaml/.json         (typed graph edges)
      │
      ├──▶ participation-graph/   build.ts → graph.json + by-seed.json
      │          │
      │          ▼
      │    identity-forest/       build.ts → forest.svg/json + index.html
```

Everything after extraction is deterministic, re-runnable and read-only over its sources. A Seed record is plain Markdown with YAML frontmatter, and it belongs to the community that produced it.

## Settings

| Variable | Default | What |
| --- | --- | --- |
| `SEEDS_LLM_URL` | `http://localhost:11434/v1/chat/completions` | Any OpenAI-compatible chat endpoint. The default is a model on your own machine (Ollama) |
| `SEEDS_LLM_MODEL` | `qwen2.5:14b-instruct` | The model name that endpoint expects |
| `SEEDS_LLM_KEY` | empty | Sent as a bearer token if set |
| `SEEDS_SESSIONS` | `vault/calls/chaos-sessions` | Session folders |
| `SEEDS_VAULT` | `vault` | Where Seed records and concepts are written |
| `SEEDS_DIR` | `vault/seeds` | Seed records, for the graph and the forest |
| `COMMENT_ROOT`, `PARTICIPATION_OUT` | `comments`, `participation` | Participation graph in and out |

## Running it

Requirements: [Bun](https://bun.sh), Python 3.11+ with `pyyaml` and `aiohttp`.

```bash
python3 profiles/chaos-sessions/seed-builder/extract.py CS16      # one session, needs a model
python3 profiles/chaos-sessions/seed-builder/distribute.py         # Seed records from extracted YAML
bun run profiles/chaos-sessions/participation-graph/scripts/build.ts
bun run profiles/chaos-sessions/identity-forest/scripts/build.ts
```

# Participation graph

The participation graph is the **naive-joining pattern made explicit**: every
comment, reply, endorsement and mention is an *edge* between seeds. It is the
relational layer under "participation is membership" — the same interactions
that mint/re-anchor a Kreivo membership also draw an edge here. Alerts
(reply-to-me, mention-of-me) are just a query over this graph.

## Build

```bash
bun run participation-graph/scripts/build.ts
```

- **Input** — every `*.jsonl` under the comment roots listed in `build.ts`
  (default `comments/`, override with `COMMENT_ROOT`). Add a collective by
  adding its comment dir to `COMMENT_ROOTS`.
- **Output** — `participation/`
  - `graph.json` — `{ nodes:[seed], edges:[authored|commented-on|replied-to|mentioned] }`
  - `by-seed.json` — per-seed inbox: `authored`, `commentedOn[]`, and the alert
    source of truth `repliesReceived[]` / `mentionsReceived[]`.
- Deterministic, re-runnable, read-only over the comment stores. Retracted
  comments still count the seed as a participant (a node) but write no content edges.

## Edge model

| edge | from → to | meaning |
| --- | --- | --- |
| `authored` | seed → comment | seed wrote this utterance |
| `commented-on` | seed → rfc/target | seed participated on this doc |
| `replied-to` | seed → parent-author seed | resolved from `replyTo` (parent comment id) |
| `mentioned` | seed → mentioned seed | parsed `@handle`, resolved against the alias table |

## Alerts (the first consumer)

To alert a seed when they receive a reply or mention: read `by-seed.json`,
diff against the last-notified watermark per seed, and for each new inbound
edge look up the seed's channel and notify. Channels available per seed today:
**email** (only durable one, from register) and the shared Birdbrain **Matrix
room** broadcast (the collective's Matrix-room announcer). There is
no per-seed Matrix DM until a seed's Matrix id is stored at sign-in.

## Known gaps (verified 2026-07-26)

1. **Legacy comments have no `id`** (pre-dating the field, incl. Michiel's on
   RFC-001), so they can't be `replyTo` targets by id. Fix: a one-time id
   backfill migration over the comment stores.
2. **Plain names aren't mentions** — only `@handle` (or an explicit `mentions[]`
   captured at write time) resolves. To make replies/mentions reliably alertable,
   capture `mentions[]` in the chaos-auth `/rfc/comment/*` handlers at write time
   and set `replyTo` to a real (backfilled) parent id.
3. **No per-seed channel book** beyond email — Matrix is minted per-login and not
   persisted. Storing a seed's Matrix id at self-custody sign-in unlocks DMs.

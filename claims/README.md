# Claims

A claim is someone saying something about a person and a thing. "That Seed is me." "Alice was Camera Operator on this film." "Bob wrote that section." It is said once, sits open where the group's members can see it, and then settles, is disputed or is withdrawn.

Saying who you are and taking credit for work are the same object. They differ only in the rule that settles them, and the rule is a profile setting. One format means one open list for a group, one record per member and one way to anchor what settled.

`claims.ts` is the whole of it: the event format, the fold, the gates and the anchor digest. It has no dependencies and does no I/O.

## The ledger

A ledger is a JSONL file, one event per line, append-only. It lives on the group's own server. Nothing is ever edited or deleted. A correction is a new claim that names the one it replaces.

| Field | On | What it is |
| --- | --- | --- |
| `v` | all | `1` |
| `id` | all | unique event id |
| `at` | all | ISO-8601 UTC |
| `claim` | all | the claim this event is about. A profile may derive it (film + role + name) so the same claim said twice is one claim |
| `act` | all | see below |
| `by` | all | the member acting: a handle or an account |
| `kind` | assert, amend | open namespace: `identity`, `credit`, or whatever a profile names. Unknown kinds are kept and shown |
| `profile` | assert, amend | whose rule settles it |
| `subject` | assert, amend | who the claim is about. Empty means a known role nobody has filled |
| `relation` | assert, amend | what they did: `is`, `Camera Operator`, `wrote` |
| `target` | assert, amend | what it was done on: `seed:<slug>`, `film:<id>`, a CID |
| `until` | assert, amend | optional later end to the window. Never earlier than the rule allows |
| `evidence` | assert, amend | `{who, what, when, ref}` items: a call sheet, a session, a passkey |
| `supersedes`, `reason` | amend | the settled claim this corrects, and why. A reason is required |
| `reason` | object | why. Required |
| `objection`, `outcome` | resolve | which objection, `upheld` or `dismissed` |
| `chain` | anchor | `{network, community, block, extrinsic, digest}` |
| `note`, `sig`, `ext` | any | free text, an optional signature, profile fields kept verbatim |

### Acts

- `assert` opens a claim. `amend` opens a correction to a settled one.
- `confirm` is the person named saying yes, that was me. If they made the claim themselves, someone else confirms.
- `vouch` is another member standing behind it.
- `object` pauses it until it is resolved. `resolve` rules on one objection: upheld rejects the claim, dismissed lets it run on.
- `withdraw` is the asserter or the person named pulling it before it settles.
- `apply` records that the server has written what the settled claim changes (a Seed file, a credit panel).
- `anchor` records that its digest is on chain.

## The rule

Each profile gives each kind a rule. Two shapes cover what we have seen:

```ts
optimistic: { window: 7 days, confirm: false, vouches: 0, amend: { window: 7 days, vouches: 1 } }
witnessed:  { window: 0,      confirm: true,  vouches: 1, amend: { window: 7 days, vouches: 2 } }
```

**Optimistic** settles when its window closes with nothing open against it. It is how a Seeds point matures, and how a Seed claim settles. **Witnessed** settles when the person named has confirmed and enough other members have vouched. It is how a film credit settles. A rule can ask for both.

A correction always costs more than the claim it replaces: a written reason, a window in which the person currently named can object, and more vouches. Raising the numbers later is a settings change, and old ledgers fold the same.

## States

Every claim is in one of six states.

| State | Meaning |
| --- | --- |
| `open` | in progress. `waiting` says on what: `confirm`, `vouches` or `window` |
| `disputed` | an objection is unresolved |
| `settled` | the rule is met. It stays settled whatever is said afterwards |
| `rejected` | an objection was upheld |
| `withdrawn` | pulled before it settled. It can be said again, and starts over |
| `superseded` | a settled correction replaced it |

Settling is decided as of each moment in the ledger. An objection that arrives after the window closed is too late. After that, only a correction moves it.

## Who may do what

`may(act, claim, who, rules)` is the one place a server, an app or a script asks. Three parties, one gesture each: whoever said it cannot confirm it, and a vouch from the asserter or the confirmer does not count. Only the person named confirms a claim about someone else. Only the asserter or the person named withdraws. An open claim is objected to, a settled one is corrected.

The fold does not check permissions. It only counts, so any honest server's ledger folds the same.

## Who sees what

The ledger stays on the group's own server and only its members read it. `openClaims()` is the group's open list: everything a member could still object to or vouch for. A window nobody can see is not a safeguard. `recordOf()` is one member's view: what they claimed, what names them, and what is waiting on them.

A settled claim can be shown beyond the group only if the person named agrees. That is the profile's call, never the format's.

## On chain

The ledger is the record and the chain is a witness to it. Only a **settled** claim is anchored, as the SHA-256 of `anchorPayload()`: the claim's id, kind, profile, subject, relation, target, what it supersedes, when it settled and the ids of the events that settled it. No evidence, notes or objections. Anyone holding the ledger can recompute the digest. Anyone holding only the chain learns that something was agreed and when, and nothing about what it says.

An anchor is a remark into the group's own community on chain. It is deliberately not a Seeds point, because a matured point mints units and a claim settling is not by itself a contribution.

## Signatures

`sig` is optional. Where present it covers `signingBytes(event)` (the canonical event without `sig`) unless it names what else it covers. A Seed claim's passkey assertion covers the profile's own canonical claim and says so with `over: "seed-claim/v1"`. Verifiers ignore schemes they do not know.

## Files

| File | |
| --- | --- |
| `claims.ts` | the format, fold, gates and anchor digest |
| `vectors.json` | ledgers and the states they must fold to. Any implementation is held to them |
| `gen-vectors.ts` | writes the vectors. The answers are written by hand, never computed by `claims.ts` |
| `test.ts` | `bun run test.ts` folds every vector and checks the gates |
| `from-seed-claims.ts` | reads the chaos-sessions Seed-claim ledger as claim events, losslessly |

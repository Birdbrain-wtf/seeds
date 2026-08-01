# Trust model

Seeds ships under two governing constraints:

1. **Open source.** Every component is published under a permissive licence
   (Apache-2.0 here).
2. **Non-custodial / trust-minimised / zero-trust by default.** Any component
   that departs from that must carry a *stated reason* and a *reclaim path*.

## Postures

- **zero-trust** — the user holds keys / verifies for themselves; no operator
  trust needed.
- **trust-minimised** — an operator exists, but its actions are open,
  deterministic and independently verifiable from public data.
- **custodial-with-reason** — an operator holds keys or funds; permitted ONLY
  with a stated reason **and** a self-custody reclaim path. Custody without a
  reclaim path is disallowed.

## Component register

| Component | Posture | Note |
| --- | --- | --- |
| Seed records (witnessed contribution profile) | zero-trust | derived deterministically from witnessed events |
| Participation / co-attendance graph | trust-minimised | deterministic, re-runnable, read-only over sources |
| Identity Forest visualisation | zero-trust | pure function of public Seed data; no keys, no model, no randomness |
| Seed → key claim (passkey binding) | zero-trust (target) | the user's own key is the anchor |
| Frictionless membership onboarding | custodial-with-reason | see below — the one accepted exception |
| Query → attribution → micro-payout | trust-minimised (target) | payer signs the split; a facilitator only verifies; no custody of routed funds |

## The one accepted custody reason

*Frictionless onboarding under decentralised governance*: an operator may
mint/derive a new member's on-chain account so that a passkey user need not
hold tokens to join — **paired with a self-custody reclaim switch** so the
member can move to full self-custody at any time. That is the only custody this
project permits, and only because the alternative (requiring token acquisition
before first participation) excludes exactly the people participation-based
identity is for.

## What was retired, and why

The original design included **behavioural writing-style fingerprinting** as a
Sybil-resistance mechanism. It is retired, for two independent reasons:

1. **It is weak.** A capable language model can trivially generate divergent
   synthetic personas; style-clustering gives probabilistic signal at best.
2. **It is surveillant.** Running stylometry on participants' words from the
   operator's side fails the trust constraint above, whatever its accuracy.

The replacement is stronger and simpler: **a witnessed contribution profile,
bound to a self-custody key, anchored as on-chain membership through real
participation.** Personhood is evidenced by the people you have actually sat
with, not by a classifier.

## Sybil stance

Sybil-resistance here is **not** one-identity-per-human. A person's canonical
Seed stays bound to their keys while supporting many alter egos, pseudonyms and
anonymous contributions — linkable back only by the person themselves. The
resistance property comes from value and weight flowing through *witnessed,
real participation and relationships*: a thousand puppet identities that never
sat in a room with anyone carry no weight.

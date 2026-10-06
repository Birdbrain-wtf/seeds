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
| Seeds chain admission (`chain/`) | trust-minimised | members admit by witnessing against shared evidence; every rule is on-chain and every mint can be checked by anyone |
| Seeds chain member key | zero-trust | derived on the member's own device from their passkey; no operator ever holds it, and with no fees nobody has to sponsor it |
| Seeds chain opening control | trust-minimised, with a stated end | a first member's upgrade passes unless a third of members object; members end that control by simple majority, once, for good |
| Presence roots (`presence/`) | trust-minimised | rebuilt by anyone from the published roster; fixed in public before anything is decided against them |
| Conformance vectors (`conformance/`) | zero-trust | anyone runs them against any engine |
| Jambo validators | trust-minimised (lab) | a named validator set, said plainly; opening it up is the published next step, not an assumption |

## Custody

The protocol carries no custody exception (the one earlier projects needed is under Legacy, below). A member's key comes from their own passkey, the chain charges no fees, so a newcomer needs no tokens to write, and nobody mints or derives a key on their behalf.

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

On the chain the same stance meets a sharper constraint, because a membership
carries a vote and can carry a validator seat. So the hierarchy is fixed: one
person, one canonical Seed, one membership. Pseudonyms and alter egos never hold
a membership of their own. They contribute under their owner's Seed, and the
credit flows back to it when the owner chooses to claim it, but the vote stays
with the Seed.

A new membership is for a new person. Two members witness that, each from a
small allowance per era, and if the new member later turns out to be someone's
second face, it is expelled and everyone who vouched for it takes a strike. The
chain can't tell whether two keys are one person. The witnesses carry that, and
they carry the cost of getting it wrong. Once a personhood registry exists
underneath, it can enforce one membership per person directly, and witnessing
goes back to being evidence of participation rather than a guard against
duplicates.

## Legacy: the custody exception before the Seeds chain

Before the Seeds chain existed, membership lived on a chain that charged fees, and this register carried one accepted exception:

*Frictionless onboarding under decentralised governance*: an operator may
mint/derive a new member's on-chain account so that a passkey user need not
hold tokens to join — **paired with a self-custody reclaim switch** so the
member can move to full self-custody at any time. That was the only custody the
project permitted, and only because the alternative (requiring token acquisition
before first participation) excludes exactly the people participation-based
identity is for.

It applies only to memberships still held on such a chain, and goes when they move. It is kept here so the history of what was permitted stays readable. A profile that wanted custody would have to state its own reason and reclaim path; the protocol grants none.


# Seeds

**Identity grown from witnessed participation: a membership and contribution record a personhood check can sit beneath.**

A **Seed** is who someone is to a group, built from what they actually took part in: the sessions they were witnessed at, who they sat beside, what they put forward and which of it held up. It is bound to a key the person holds, not issued by anyone. Seeds is the set of rules that turns that into a membership with a vote, and a record of contributions that anyone can check.

This repository is [Birdbrain](https://birdbrain.wtf)'s. It holds the protocol, a reference implementation, the tests that hold any implementation to it, and one group's tooling beside it.

## What is here

| Folder | What it is |
| --- | --- |
| [`spec/`](spec) | The protocol in two papers: [*Seeds: A Store of Values*](spec/seeds-intro.pdf), the white paper, and [*Seeds: A Chain with One Job*](spec/seeds.pdf), the specification |
| [`chain/`](chain) | The reference runtime. Five pallets, one of them Seeds: admit, record, mint, vote, seat validators |
| [`conformance/`](conformance) | The rules as 28 vectors. Any engine that claims to run Seeds is held to them. The reference runtime passes all 28 |
| [`presence/`](presence) | Attendance roots: who was in the room, as a Merkle root anyone can rebuild. The evidence admission reads |
| [`profiles/`](profiles) | Networks that run the protocol with their own settings. [`chaos-sessions/`](profiles/chaos-sessions) is the first, with the tooling that turns its sessions into Seed records and draws them as a forest |

The same rules also run as JAM services in a separate repository, [Jambo](https://github.com/Birdbrain-wtf/jambo).

## The rules

| Rule | In the protocol |
| --- | --- |
| You are evidenced by people who were there | Admission takes two members naming the same session evidence |
| Your key is yours | A member key comes from the person's own passkey. No operator holds it, and with no fees nobody has to sponsor it |
| Only members write | A non-member's transaction is refused before it reaches the pool |
| New units only where something held up | Units are minted when an unchallenged point matures, and nowhere else. Joining mints nothing. A network may start from balances claimable from an earlier ledger, which move only on the old key's signature |
| Units are a record, not a currency | There is no transfer |
| One member, one vote | Upgrades and the end of founding control are decided by members. No key can bypass a vote |

[`TRUST.md`](TRUST.md) says what each component is trusted with and why.

## Protocol and profiles

The protocol is kept small on purpose. A **profile** is a network running it with its own settings: the unit's name, how much a matured point creates, witnesses, caps, periods, seats. A profile may add funding, licences or prices above the chain, as contracts between people. It may never add anything that mints, gives a vote, or gives a place in line to whoever funds a group. See [`profiles/`](profiles).

## Running it

```bash
bash chain/scripts/e2e.sh 2>&1 | tee run.log    # build, start three nodes, walk every rule (Rust, ~12 min once built)
bun run conformance/check-log.ts run.log         # hold the run to the vectors
cd presence && bun install && bun run attendance-root.ts self-test
```

## Releases

Every release is content-addressed, signed by Birdbrain's release key and fixed on a network Birdbrain runs. Git is the working copy; the root of trust is the CID and the signed commitment. See [`RELEASES.md`](RELEASES.md).

## Status

Lab software. The reference chain has run as a three-node network and holds no value. The Chaos Sessions tooling runs daily against a real group's sessions. Computed admission (from attendance roots alone, challenged by exception) and links between points are specified as proposals and not built.

Code is Apache-2.0. The papers are CC-BY-4.0.

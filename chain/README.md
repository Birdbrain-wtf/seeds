# The Seeds chain

The reference runtime of the Seeds protocol. It keeps the record of who joined a community, what they put forward, and which of it held up.

The rest of this repo works out who a person is from what they actually took part in. This is where that becomes binding. Members admit people, and the record of what held up is kept, by rules nobody can quietly change.

It runs five pallets and nothing else: `System`, `Timestamp`, `Aura` and `Grandpa` for blocks and finality, and `Seeds`, which does everything the chain is for. There are no balances or fees, no sudo key and no treasury.

This is lab code. It has run as a three-node network and holds no value.

## The five jobs

All five live in one pallet, [`pallet/src/lib.rs`](pallet/src/lib.rs), whose header explains each in full.

| Job | In one line |
| --- | --- |
| Admit | Two existing members witness a newcomer against the same session evidence. Each witness has an allowance per era and each community a cap, and a member who is later expelled leaves a strike on everyone who vouched for them. |
| Mint | Units are created in one place only: when a point someone put forward matures. Joining mints nothing, and first members start with nothing. |
| Record | Putting a point forward costs nothing. If three members challenge it, it fails, nothing is minted and the proposer takes a strike. If not, it matures and the maturity mint is added. A member can have three points open at once. |
| Approve upgrades | One member, one vote. A set of first members starts the chain, and members end their control by simple majority, once. After that, any member can apply an approved upgrade. |
| Seat validators | Members who register keys queue for a seat, oldest admission first, up to 21. Each era the chain hands the list to consensus. |

Only members can sign a transaction, which is what stands in for fees as the guard against spam. The one exception is `claim`, which lets a holder of an earlier chain move their snapshot balance across with a signature from their old key, so nobody's balance moves without them. The signature covers this network's genesis hash, so a claim made on one Seeds network cannot be replayed on another. The old key can be sr25519, ed25519, ECDSA or a passkey, checked on the chain.

There is no transfer. Units are a record of what held up, not a currency.

## How it meets the rest of Seeds

| Here | Elsewhere |
| --- | --- |
| The evidence a witness names when admitting someone | An attendance root over a session, built and checked by [`presence/`](../presence) |
| The member's key | Derived on their own device from a passkey, never held by an operator. See [`TRUST.md`](../TRUST.md) |
| Points put forward and matured | The shared concepts and typed edges the Chaos Sessions seed builder writes ([`profiles/chaos-sessions/`](../profiles/chaos-sessions)). Nothing joins the two yet. The plan is for a point to be the digest of one, so the graph and the chain can be checked against each other |
| What any engine must do | [`conformance/`](../conformance): the rules as vectors. This chain passes all 28 |
| The same rules on a different engine | [Jambo](https://github.com/Birdbrain-wtf/jambo), a reduced JAM client. Its first service is a member register, the first slice of the admission step here, and the other jobs are meant to follow one at a time |

## Build and run

You need [rustup](https://rustup.rs) (the toolchain is pinned in `rust-toolchain.toml` and installs itself), `clang`, `protoc` and, for the end-to-end test, [Bun](https://bun.sh). It builds from the published Polkadot SDK crates (release `polkadot-stable2606-2`), so there is nothing else to check out.

```bash
cd chain
cargo test -p pallet-seeds    # the pallet's unit tests
bash scripts/build.sh         # node + runtime, target/release/seeds-node
bash scripts/net-up.sh        # three local nodes: alice and bob validate, dave waits for a seat
bash scripts/net-down.sh --wipe
```

A cold build takes a while: the SDK is large.

## The end-to-end test

```bash
bash scripts/e2e.sh
```

This builds the node and a second runtime one version ahead, starts three nodes from a fresh genesis, and walks every job on the live chain. A non-member is refused before the pool. One witness does not admit, and two who name different evidence do not either. Two who agree admit Dave, nothing is minted, and he can then write without fees. A claim signed for another network is refused, so is one signed for the wrong account, and the right one moves 1,000 units across. A point is put forward with no bond. Three challenges fail another point, with a strike on its proposer and no mint. A first member's upgrade passes with no objection, and any member applies it, with no sudo and no restart. Members vote opening control away. Dave's point matures and mints 10, the only mint. Total issuance is exactly that maturity plus the snapshot. At the next era Dave takes a validator seat, and finality carries on past the change. It prints one line per check and exits non-zero if any fail. It takes about twelve minutes.

## Lab values, and what is still open

The constants in [`runtime/src/configs/mod.rs`](runtime/src/configs/mod.rs) are short, so a whole cycle fits one sitting: a 10-minute era, 5-minute maturity, 2-minute votes and 10 units at maturity. None of them is a proposal. The unit has no name in the protocol: a network that runs it names its own.

Not settled yet:

- **Admission from attendance alone.** Here two members still send a `witness` call each. The aim is for membership to follow from the attendance record itself, two sessions alongside the same members, with no extra step for anyone. The chain does not compute that yet.
- **Weights** are set by hand, not benchmarked.
- **Rate limits.** Open points are capped at three per member, but there is no general rate limit. A member could still fill blocks with votes, and today the only answer is expulsion.
- **The genesis.** The snapshot loader for real balances, and a chain spec with real first members on separate machines.
- **Collectives and holders.** Collectives with their own accounts and their own votes are designed but not built. So is a holder tier: keys that aren't admitted people, allowed a short list of calls and charged a flat fee for them. Neither changes the rules above. A holder never votes or witnesses, and people still write for free.

## Provenance

The node and runtime started from the Polkadot SDK's solochain template, which is released into the public domain, and were cut down to the five pallets above. The pallet is new. Everything here is Apache-2.0.

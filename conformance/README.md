# conformance

The rules, as vectors any engine is held to.

Seeds has one protocol and more than one engine: the FRAME reference runtime in [`chain/`](../chain), and the JAM services in [Jambo](https://github.com/Birdbrain-wtf/jambo). Without a shared test the two would drift into two protocols. [`vectors.json`](vectors.json) is that test. Each vector states one rule and what must be observed when it holds, in terms that name no engine.

| Group | Vectors | What they hold an engine to |
| --- | --- | --- |
| shape | S01–S06 | What exists at genesis: first members, no units, no transfer, opening control |
| gate | G01 | Only members write |
| admission | A01–A05 | Two witnesses on the same evidence admit; admission mints nothing; members write without fees |
| claim | C01–C04 | A claim is bound to one network and one destination; the old key alone moves a snapshot balance, once |
| points | P01–P03 | A point needs no bond; three challenges fail it, with a strike on the proposer |
| governance | U01–U03 | A first member's upgrade passes unless members object; anyone applies authorised code; members end opening control |
| issuance | M01–M03 | Maturity is the only mint, and issuance is exactly maturities plus claimed snapshot |
| seats | V01–V03 | Queued members' keys join at an era and the chain keeps finalising |

`scope` says who is bound. **protocol** vectors bind every engine. **reference** vectors (S01, S06, V01, V03) name the FRAME runtime's pallets or its consensus, so they bind only `chain/`.

## Running it

The reference end-to-end run prints one line per vector. Hold a run log to the suite:

```
bash chain/scripts/e2e.sh 2>&1 | tee run.log
bun run conformance/check-log.ts run.log
```

It exits non-zero if any vector is missing or failed. [`runs/frame-2026-10-05.log`](runs/frame-2026-10-05.log) is the run behind the current release: 28 of 28 on a fresh three-node network, spec 102 upgraded to 103 along the way.

## Where each engine stands

| Engine | Vectors held |
| --- | --- |
| FRAME reference (`chain/`) | 28 of 28 |
| Jambo (JAM services) | none in full. The member register writes a member, which is part of A03; witness signatures are next |

The `jambo` column in `vectors.json` is updated as each service lands. A vector is only marked held when that engine prints a passing line for it, never on a reading of its code.

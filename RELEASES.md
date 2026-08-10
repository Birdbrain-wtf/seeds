# Releases

Every release is content-addressed and anchored on-chain. Git is the working
mirror; the root of trust is the CID + the chain commitment.

Each release directory contains `seeds-<tag>-src.tar.gz` (a `git archive` of
the repo at the tagged commit) and `forest/` — the built Identity Forest,
fully self-contained: open `forest/index.html` on any IPFS gateway and the
whole living piece (all four dimensions, sound included) serves trustlessly.

To verify a release: fetch the CID, unpack the tarball, compare against the
tagged commit; check the `System.remark` transaction carries the same CID.

| tag | commit | CID | on-chain anchor | date |
|---|---|---|---|---|
| v1 | `0d11b6e` | [`bafybeihixnfww2q…`](https://ipfs.io/ipfs/bafybeihixnfww2qx5xquwvkm5gccszniwwn3tlmq3jkto3gpcmtvm6uq4y/) | `0x1c64dc31ad929296…` (kreivo) | 2026-08-10 |

## Full identifiers

- **v1** — `bafybeihixnfww2qx5xquwvkm5gccszniwwn3tlmq3jkto3gpcmtvm6uq4y`
  - anchor tx `0x1c64dc31ad92929674f6bacc124f2b90e16df390d94e261a091ca52d89bcf44d` on kreivo (System.remark: `BIRDBRAIN::RELEASE::seeds::v1::<cid>::<sha>`)

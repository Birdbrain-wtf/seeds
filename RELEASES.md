# Releases

A release is a CID, signed and fixed in public. Git is the working copy. The root of trust is the content address and the signed commitment, not this repository.

From v2, every release is:

- **Content-addressed.** One CID covers `seeds-<tag>-src.tar.gz` (a `git archive` of the tagged commit, papers included under `spec/`), `forest/` (the built Identity Forest, self-contained) and `release.json`.
- **Served by Birdbrain.** `https://ipfs.birdbrain.wtf/ipfs/<cid>/` runs on Birdbrain's own machine and serves only what it pins. A CID is a specification, not a service, so any gateway or a local `ipfs get <cid>` returns the same bytes or none.
- **Signed and fixed on a network Birdbrain runs.** A `System.remarkWithEvent` on the BBT chain (`wss://rpc.birdbrain.wtf`), signed by Birdbrain's release key `5DFXkAKLVMnmyexsYXHs8tBSmbpvEMPWjB1iiNpmJN3SrGC8`, carrying `BIRDBRAIN::RELEASE::seeds::<tag>::<cid>::<commit>`. When a persistent Seeds network runs, releases move onto it. The release key is one key today and is meant to become a threshold of maintainers.

| tag | commit | CID | fixed in | date |
|---|---|---|---|---|
| v2 | `f8d7170` | [`bafybeib2y724ril…`](https://ipfs.birdbrain.wtf/ipfs/bafybeib2y724rilxyupvfundsy5scyhjrjhi5fxcnm76m2f6lbigqfalci/) | BBT #142890-1 | 2026-10-05 |
| v1 | `0d11b6e` | [`bafybeihixnfww2q…`](https://ipfs.birdbrain.wtf/ipfs/bafybeihixnfww2qx5xquwvkm5gccszniwwn3tlmq3jkto3gpcmtvm6uq4y/) | Kreivo, tx `0x1c64dc31ad…` (legacy) | 2026-08-10 |

## Check a release yourself

1. Fetch it: `ipfs get <cid>`, or download from the gateway.
2. Compare the source: `git archive --format=tar.gz <commit> | gunzip | sha256sum` against `gunzip -c seeds-<tag>-src.tar.gz | sha256sum`.
3. Read the commitment: open `https://polkadot.js.org/apps/?rpc=wss://rpc.birdbrain.wtf#/explorer/query/<block>`, find the extrinsic, and check its signer is the release key and its remark carries the same CID and commit.
4. Hold the code to the rules: `bash chain/scripts/e2e.sh | tee run.log && bun run conformance/check-log.ts run.log`.

## Full identifiers

### v2

- commit `f8d7170`
- CID `bafybeib2y724rilxyupvfundsy5scyhjrjhi5fxcnm76m2f6lbigqfalci`
- source `https://ipfs.birdbrain.wtf/ipfs/bafybeib2y724rilxyupvfundsy5scyhjrjhi5fxcnm76m2f6lbigqfalci/seeds-v2-src.tar.gz`
- fixed on the BBT chain (genesis `0x590faee06c5152afe2841247408bc2cff08a738482bc21581d9cd622a4080260`) in block #142890, `0xab65b7059011995479deb363a869b2e20c08b2e0df3ab85d636db43f90505b0d`, extrinsic 1, tx `0xd7d5b9b9603ab02e35008ebe9e737e2bd100d0f8766360e6379ad8cddf94e4b0`
- signed by the release key `5DFXkAKLVMnmyexsYXHs8tBSmbpvEMPWjB1iiNpmJN3SrGC8`
- remark `BIRDBRAIN::RELEASE::seeds::v2::bafybeib2y724rilxyupvfundsy5scyhjrjhi5fxcnm76m2f6lbigqfalci::f8d7170`

### v1

- commit `0d11b6e`
- CID `bafybeihixnfww2qx5xquwvkm5gccszniwwn3tlmq3jkto3gpcmtvm6uq4y`
- source `https://ipfs.birdbrain.wtf/ipfs/bafybeihixnfww2qx5xquwvkm5gccszniwwn3tlmq3jkto3gpcmtvm6uq4y/seeds-v1-src.tar.gz`
- legacy: fixed on Kreivo, tx `0x1c64dc31ad92929674f6bacc124f2b90e16df390d94e261a091ca52d89bcf44d`, block `0xe50ee7136ff872762204c2793a13c7e5dbc678d524282279d604c7b31c3567a3`, by the operator of a downstream collective, before releases were Birdbrain's own. Remark `BIRDBRAIN::RELEASE::seeds::v1::<cid>::<sha>`. Served by Birdbrain's gateway only if pinned there

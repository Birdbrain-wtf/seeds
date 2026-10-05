# presence

Who was in the room, as a root anyone can rebuild.

Seeds admits a newcomer when two members name the same session evidence. This is where that evidence comes from. A session's sign-ins become a Merkle root, the root is fixed in public before anything is decided against it, and anyone can rebuild it from the published roster and check a single attendee against it. Nobody has to take an organiser's word for who was there, and nobody has to do anything at the session beyond signing in as they already would.

## What a leaf says

```
leaf = blake2_256( 0x00 ‖ P ‖ pubkey32 ‖ blake2_256(session_id) )
node = blake2_256( 0x01 ‖ sort(a, b) )
P    = blake2_256(person_id)
```

Each leaf binds a person, the one account that person signs with, and the session. The self-test checks three consequences:

- **One person, one account.** A roster that gives one person two accounts, or one account to two people, is refused before a root exists.
- **No replay.** A proof from one session does not verify against another session's root.
- **No substitution.** A proof does not verify under anyone else's person slot.

## Rosters carry no names

The leaf never sees a name, only `P`, the hash of an internal person identifier. So the rosters in `rosters/` give each attendee as `person` (that hash) and still rebuild the root exactly.

This is pseudonymity, not anonymity. The identifiers are short, so someone who guesses one can confirm it against its hash, and the accounts are public. It keeps names and login handles out of a public repository while leaving every claim about the root checkable.

## Who gets a leaf

Only people who were in the room **and** signed in with a key they hold themselves. Everyone else present is written into the roster's `excluded` list with the reason, so a roster can be checked against a head count rather than trusted not to have dropped anyone:

- joined as a guest with no key, so there is no account to put in a leaf
- holds a membership only on an account someone else's key controls
- signed in, but the login is not yet matched to a person
- a second login by someone who already has a leaf

## Check it yourself

You need [Bun](https://bun.sh).

```
cd presence
bun install
bun run attendance-root.ts self-test
bun run attendance-root.ts build rosters/CS33.json
bun run verify-chain.ts rosters/CS33.json     # read the anchoring remark and compare
```

`build` prints the root and writes a proof file beside the roster. To check one leaf:

```
bun run attendance-root.ts verify <root> <session> <person> <account> <proof,proof,…>
```

## Where roots are fixed

The first published root (CS33, 14 September 2026, 4 leaves, 5 excluded) was fixed as a `System.remark` on Kusama Asset Hub, block #21,513,860, and `verify-chain.ts` reads it back from there. On a Seeds network the root becomes a point on Seeds itself, so the record and the admission it supports live in one place. Anchoring on another chain stays available as a second witness, never a requirement.

A root is published here only once it is fixed. A root published first and fixed later proves nothing about order.

## What this does not claim

The mapping from a person to their account comes from the session's own sign-in log, published afterwards and open to challenge by anyone who was there. That is a real and cheap cost to a forger. It is not a cryptographic proof of personhood. The person slot is built so that a personhood primitive can take it over without changing the leaf format.

This folder replaces the earlier `attendance-checker` repository, which framed the same code around a treasury request.

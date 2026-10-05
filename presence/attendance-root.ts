#!/usr/bin/env bun
/**
 * attendance-root.ts — build and verify a session attendance root.
 *
 * Witnessed admission needs a record of who attended a session that anyone
 * can recompute. This is that record: a
 * per-session Merkle root whose leaves bind three things together, so that an
 * inclusion proof is a self-contained "this person, holding this account,
 * attended this session" witness.
 *
 *   leaf(person, account, session)
 *     = blake2_256( 0x00 ‖ P ‖ pubkey32 ‖ blake2_256(session_id) )
 *   node(a, b)
 *     = blake2_256( 0x01 ‖ sort(a, b) )
 *
 * where P = blake2_256(person_id), the person commitment.
 *
 * WHY THE PERSON IS IN THE LEAF. A leaf that hashed the account alone would
 * answer "was this account in the room" and nothing else. One human with five
 * passkeys is five valid accounts, and an account-only leaf pays that human
 * five times and is correct every time. So the leaf carries the nullifier:
 * `person → account` is the scarce slot, one person, one claiming account per
 * session. This build refuses a roster that gives one person two accounts, or
 * one account to two people, so the sybil case is caught before it reaches a
 * root rather than after it reaches an admission.
 *
 * PUBLISHED ROSTERS CARRY THE COMMITMENT, NOT THE NAME. Because the leaf only
 * ever sees blake2_256(person_id), a roster can give each attendee as `person`
 * (the 32-byte commitment, hex) instead of `person_id`, and it rebuilds the
 * same root. That is how the rosters in this repository are published. It is
 * pseudonymity, not anonymity: person_id is a short slug, so anyone who
 * guesses a slug can confirm it against its commitment. The accounts are
 * public on chain either way.
 *
 * Binding session_id in too means a proof from one session cannot be replayed
 * against another session's root even if the pair is unchanged.
 *
 * DOMAIN SEPARATION. The 0x00/0x01 tags make a leaf preimage and a node
 * preimage differ in their first byte whatever their length. Each
 * variable-length field is hashed to 32 bytes before it goes in, so the
 * concatenation is fixed-width and unambiguous.
 *
 * Everything here is pure and offline. Anchoring a root is a separate signed
 * System.remark carrying `birdbrain/attendance/v2:<session>:<root>`. This tool
 * prints that payload and never broadcasts anything.
 *
 * Usage:
 *   bun run attendance-root.ts self-test
 *   bun run attendance-root.ts build  rosters/CS33.json
 *   bun run attendance-root.ts verify <root> <session> <person-id|0xcommitment> <account> <proof,proof,…>
 */

import { blake2AsU8a, cryptoWaitReady, decodeAddress } from "@polkadot/util-crypto";
import { hexToU8a, u8aToHex } from "@polkadot/util";

const REMARK_TAG = "birdbrain/attendance/v2";
const LEAF_TAG = 0x00;
const NODE_TAG = 0x01;

// ---- primitives ----

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const tag = (t: number) => new Uint8Array([t]);
const hashText = (s: string) => blake2AsU8a(new TextEncoder().encode(s), 256);

/** A person_id must be a stable slug, not a display name or a login handle. */
function normalisePersonId(personId: string): string {
  const id = personId.trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`person_id must be a lowercase-hyphenated slug, got: ${JSON.stringify(personId)}`);
  }
  return id;
}

const COMMITMENT = /^0x[0-9a-f]{64}$/;

/** The person slot as the leaf sees it: a slug is hashed, a 0x commitment is taken as given. */
function personCommitment(person: string): Uint8Array {
  const p = person.trim();
  return COMMITMENT.test(p) ? hexToU8a(p) : hashText(normalisePersonId(p));
}

function leafHash(person: string, account: string, session: string): Uint8Array {
  return blake2AsU8a(
    concat(tag(LEAF_TAG), personCommitment(person), decodeAddress(account), hashText(session)),
    256,
  );
}

function nodeHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  return blake2AsU8a(concat(tag(NODE_TAG), lo, hi), 256);
}

// ---- tree ----

interface Entry {
  personId: string;
  account: string;
  handle?: string;
}

interface Tree {
  session: string;
  entries: Entry[]; // canonical order (sorted by leaf hash)
  leaves: Uint8Array[];
  layers: Uint8Array[][];
  root: Uint8Array;
  indexOf: Map<string, number>; // leaf-hex -> index
}

function buildTree(session: string, raw: Entry[]): Tree {
  if (!session) throw new Error("session id is required — it is bound into every leaf");

  // The nullifier, enforced at build time. One person, one claiming account.
  const accountOf = new Map<string, string>();
  const personOf = new Map<string, string>();
  const prepared: { entry: Entry; leaf: Uint8Array }[] = [];

  for (const e of raw) {
    const personId = u8aToHex(personCommitment(e.personId)); // slug and its commitment are one person
    const pubkey = u8aToHex(decodeAddress(e.account)); // throws on malformed ss58

    const seenAccount = accountOf.get(personId);
    if (seenAccount && seenAccount !== pubkey) {
      throw new Error(
        `person ${e.personId} appears with two accounts in one session — ` +
          `the roster must name the single account they claim with`,
      );
    }
    const seenPerson = personOf.get(pubkey);
    if (seenPerson && seenPerson !== personId) {
      throw new Error(`account ${e.account} is claimed by two different people`);
    }
    if (seenAccount) continue; // same person, same account, seen twice — one leaf

    accountOf.set(personId, pubkey);
    personOf.set(pubkey, personId);
    prepared.push({ entry: e, leaf: leafHash(e.personId, e.account, session) });
  }

  if (prepared.length === 0) throw new Error("empty roster");
  prepared.sort((x, y) => compareBytes(x.leaf, y.leaf)); // canonical, order-independent

  const entries = prepared.map((p) => p.entry);
  const leaves = prepared.map((p) => p.leaf);
  const indexOf = new Map<string, number>();
  leaves.forEach((l, i) => indexOf.set(u8aToHex(l), i));

  const layers: Uint8Array[][] = [leaves];
  let cur = leaves;
  while (cur.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(i + 1 < cur.length ? nodeHash(cur[i], cur[i + 1]) : cur[i]); // odd node promoted
    }
    layers.push(next);
    cur = next;
  }
  return { session, entries, leaves, layers, root: layers[layers.length - 1][0], indexOf };
}

function makeProof(tree: Tree, personId: string, account: string): Uint8Array[] {
  const leaf = leafHash(personId, account, tree.session);
  const start = tree.indexOf.get(u8aToHex(leaf));
  if (start === undefined) throw new Error(`not in roster for ${tree.session}: ${personId} / ${account}`);
  const proof: Uint8Array[] = [];
  let idx = start;
  for (let l = 0; l < tree.layers.length - 1; l++) {
    const layer = tree.layers[l];
    const sib = idx ^ 1;
    if (sib < layer.length) proof.push(layer[sib]); // else promoted: no sibling this layer
    idx = Math.floor(idx / 2);
  }
  return proof;
}

function verifyProof(
  root: Uint8Array,
  personId: string,
  account: string,
  session: string,
  proof: Uint8Array[],
): boolean {
  let node = leafHash(personId, account, session);
  for (const p of proof) node = nodeHash(node, p);
  return compareBytes(node, root) === 0;
}

// ---- remark payload (anchoring hint, not broadcast) ----

function remarkPayload(session: string, root: Uint8Array): string {
  return `${REMARK_TAG}:${session}:${u8aToHex(root)}`;
}

// ---- commands ----

interface Roster {
  session: string;
  date?: string;
  note?: string;
  // person_id (a slug) or person (its 32-byte commitment, hex). Published rosters use person.
  attendees: { person_id?: string; person?: string; handle?: string; account: string; custody?: string; provenance?: string }[];
  excluded?: { handle?: string; reason: string; person_id?: string }[];
}

async function cmdBuild(path: string) {
  const roster = (await Bun.file(path).json()) as Roster;
  const tree = buildTree(
    roster.session,
    roster.attendees.map((a) => {
      const personId = a.person_id ?? a.person;
      if (!personId) throw new Error(`attendee ${a.account} has neither person_id nor person`);
      return { personId, account: a.account, handle: a.handle };
    }),
  );
  const rootHex = u8aToHex(tree.root);

  const meta = new Map(roster.attendees.map((a) => [(a.person_id ?? a.person)!, a]));
  const proofs = tree.entries.map((e) => {
    const proof = makeProof(tree, e.personId, e.account).map((p) => u8aToHex(p));
    // Not `proof.map(hexToU8a)`: map passes the index as the second argument,
    // which hexToU8a reads as bitLength, so every element after the first is
    // silently resized. v1 carried this same line and never fired it, because
    // the only roster it was ever run on held one person and an empty proof.
    const ok = verifyProof(tree.root, e.personId, e.account, tree.session, proof.map((h) => hexToU8a(h)));
    const published = COMMITMENT.test(e.personId);
    return {
      ...(published ? {} : { person_id: e.personId }),
      person: u8aToHex(personCommitment(e.personId)),
      ...(e.handle ? { handle: e.handle } : {}),
      account: e.account,
      custody: meta.get(e.personId)?.custody ?? null,
      leaf: u8aToHex(leafHash(e.personId, e.account, tree.session)),
      proof,
      verified: ok,
    };
  });

  const anchor = {
    version: REMARK_TAG,
    session: roster.session,
    date: roster.date ?? null,
    note: roster.note ?? null,
    root: rootHex,
    memberCount: tree.entries.length,
    remark: remarkPayload(roster.session, tree.root),
    builtAt: new Date().toISOString(),
    excluded: roster.excluded ?? [],
    proofs,
  };

  const outPath = path.replace(/\.json$/, "") + ".anchor.json";
  await Bun.write(outPath, JSON.stringify(anchor, null, 2) + "\n");

  console.error(`session   ${roster.session}${roster.date ? `  (${roster.date})` : ""}`);
  console.error(`people    ${tree.entries.length}${roster.excluded?.length ? `  (${roster.excluded.length} excluded)` : ""}`);
  console.error(`root      ${rootHex}`);
  console.error(`remark    ${anchor.remark}`);
  console.error(`proofs    all verified: ${proofs.every((p) => p.verified)}`);
  console.error(`written   ${outPath}`);
  console.error("");
  console.error("to anchor:  bun run src/anchor-attendance.ts --anchor=" + outPath);
  if (!proofs.every((p) => p.verified)) process.exit(1);
}

function cmdVerify(rootHex: string, session: string, personId: string, account: string, proofCsv: string) {
  const root = hexToU8a(rootHex);
  const proof = proofCsv.split(",").filter(Boolean).map((h) => hexToU8a(h.trim()));
  const ok = verifyProof(root, personId, account, session, proof);
  console.log(
    ok
      ? `VALID   — ${personId} attended ${session} holding ${account}`
      : "INVALID — proof does not reconstruct root",
  );
  process.exit(ok ? 0 : 1);
}

function cmdSelfTest() {
  const SESSION = "CS-selftest";
  // Dev accounts (any ss58 prefix decodes fine) plus one real passkey account
  // registered on Kreivo, so the self-test exercises a real leaf.
  const ALICE = "5FDZzhra9wmdRSwkrnHcnbBxRNddxV2NuNrtJgdXKJzbbF86";
  const ALICE_SECOND = "5EDnsrfDxD5NC985aYkG8Qd1BEFATaHCGGMFSCbsArQU1xq6"; // same human, second passkey
  const roster: Entry[] = [
    { personId: "alice", account: ALICE },
    { personId: "bob", account: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" },
    { personId: "carol", account: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty" },
    { personId: "dave", account: "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y" },
    { personId: "erin", account: "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy" },
  ];
  const outsider = "5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw"; // mallory, not enrolled

  const tree = buildTree(SESSION, roster);
  let pass = true;
  const check = (label: string, ok: boolean) => {
    console.log(`  ${label}: ${ok ? "OK" : "FAIL"}`);
    pass = pass && ok;
  };

  // 1. every member reconstructs the root
  for (const e of roster) {
    const proof = makeProof(tree, e.personId, e.account);
    const ok = verifyProof(tree.root, e.personId, e.account, SESSION, proof);
    console.log(`  member  ${e.personId.padEnd(8)} ${e.account.slice(0, 8)}…  proof len ${proof.length}  ${ok ? "OK" : "FAIL"}`);
    pass = pass && ok;
  }

  // 2. determinism: rebuild from a shuffled roster -> identical root
  check(
    "determinism (order-independent root)",
    u8aToHex(buildTree(SESSION, [...roster].reverse()).root) === u8aToHex(tree.root),
  );

  // 3. an outsider cannot forge a proof against a member's proof
  const aliceProof = makeProof(tree, "alice", ALICE);
  check("outsider forgery rejected", !verifyProof(tree.root, "mallory", outsider, SESSION, aliceProof));

  // 4. the nullifier: alice's proof does not verify under someone else's person_id,
  //    which is what stops one human claiming twice from one anchored root
  check("person substitution rejected", !verifyProof(tree.root, "bob", ALICE, SESSION, aliceProof));

  // 5. cross-session replay: the same pair, same proof, a different session
  check("cross-session replay rejected", !verifyProof(tree.root, "alice", ALICE, "CS99", aliceProof));

  // 6. one person with two accounts is refused at build time, not at admission
  let refused = false;
  try {
    buildTree(SESSION, [...roster, { personId: "alice", account: ALICE_SECOND }]);
  } catch {
    refused = true;
  }
  check("one person, two accounts refused", refused);

  // 7. the same person twice on the same account is one leaf, not two
  check(
    "duplicate row collapses to one leaf",
    buildTree(SESSION, [...roster, { personId: "alice", account: ALICE }]).entries.length === roster.length,
  );

  // 8. two people cannot share one account
  let shared = false;
  try {
    buildTree(SESSION, [...roster, { personId: "mallory", account: ALICE }]);
  } catch {
    shared = true;
  }
  check("shared account refused", shared);

  // 9. a display name or a login handle is not a person_id
  let rejectedSlug = false;
  try {
    buildTree(SESSION, [{ personId: "Alice Smith", account: ALICE }]);
  } catch {
    rejectedSlug = true;
  }
  check("non-slug person_id rejected", rejectedSlug);

  // 10. the serialised path, which is the one a checker actually runs: a proof
  //     written to hex in the anchor file and parsed back still verifies. This
  //     is here because it did not, and the failure was invisible in-process.
  check(
    "proof survives the hex round-trip",
    roster.every((e) => {
      const hex = makeProof(tree, e.personId, e.account).map((p) => u8aToHex(p));
      return verifyProof(tree.root, e.personId, e.account, SESSION, hex.map((h) => hexToU8a(h)));
    }),
  );

  // 11. a published roster gives each person as a commitment, not a name, and
  //     must rebuild the identical root and verify the identical proofs
  const published = roster.map((e) => ({ ...e, personId: u8aToHex(blake2AsU8a(new TextEncoder().encode(e.personId), 256)) }));
  const pubTree = buildTree(SESSION, published);
  check(
    "commitment roster rebuilds the same root",
    u8aToHex(pubTree.root) === u8aToHex(tree.root) &&
      verifyProof(tree.root, published[0].personId, ALICE, SESSION, aliceProof),
  );

  // 12. a slug and its own commitment are one person, so one of each with two
  //     accounts is still the two-account case and still refused
  let mixed = false;
  try {
    buildTree(SESSION, [...roster, { personId: published[0].personId, account: ALICE_SECOND }]);
  } catch {
    mixed = true;
  }
  check("slug and commitment cannot split one person", mixed);

  console.log("");
  console.log(`  root:   ${u8aToHex(tree.root)}`);
  console.log(`  remark: ${remarkPayload(SESSION, tree.root)}`);
  console.log("");
  console.log(pass ? "SELF-TEST PASSED" : "SELF-TEST FAILED");
  process.exit(pass ? 0 : 1);
}

async function main() {
  await cryptoWaitReady();
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "self-test":
      return cmdSelfTest();
    case "build":
      if (!rest[0]) throw new Error("usage: build <roster.json>");
      return cmdBuild(rest[0]);
    case "verify":
      if (rest.length < 5) {
        throw new Error("usage: verify <root> <session> <person-id> <account> <proof,proof,…>");
      }
      return cmdVerify(rest[0], rest[1], rest[2], rest[3], rest[4]);
    default:
      console.error("commands: self-test | build <roster.json> | verify <root> <session> <person-id> <account> <proof-csv>");
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});

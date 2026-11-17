// Claims: one format for "this person says X did Y on Z".
//
// A claim is somebody saying something about a person and a thing: that Seed is me,
// I was Camera Operator on this film, Alice wrote that section. It is said once,
// sits open where members can see it, and then settles, is disputed, or is
// withdrawn. Identity claims and credits are the same object. They differ only in
// the rule that settles them, and the rule is profile config, not code.
//
//   optimistic   settles when its window closes with no open objection
//                (how a Seeds point matures, and how a Seed claim settles)
//   witnessed    settles when the person named has confirmed and enough other
//                members have vouched (how a film credit settles)
//
// A rule may ask for both. Every claim reaches the same states: open, disputed,
// settled, rejected, withdrawn, superseded. Nothing is ever deleted. A correction is
// a new claim that names the one it replaces, and costs more than the first did.
//
// The ledger is the record and the chain is a witness to it. The ledger is an
// append-only JSONL file on the collective's own server, readable by its members.
// Only the digest of a SETTLED claim is anchored on chain. Objections, notes and
// evidence never are. See README.md for the full format.
//
// This file has no dependencies and does no I/O, so any server, app or chain
// tooling can fold the same ledger and get the same answer.

export const VERSION = 1 as const;

// ── The rule ──────────────────────────────────────────────────────────────

export interface Rule {
  /** Seconds a claim stays open before it may settle. 0 = no window. */
  window: number;
  /** Must someone other than the asserter confirm? The person named, unless they asserted it themselves. */
  confirm: boolean;
  /** Distinct members, other than the asserter and the confirmer, who must vouch. */
  vouches: number;
  /** A correction to a settled claim. It should cost more than the claim it replaces. */
  amend: { window: number; vouches: number };
}

export const DAY = 86_400;

/** The two shapes profiles start from. Copy one and change the numbers. */
export const RULES = {
  optimistic: { window: 7 * DAY, confirm: false, vouches: 0, amend: { window: 7 * DAY, vouches: 1 } },
  witnessed: { window: 0, confirm: true, vouches: 1, amend: { window: 7 * DAY, vouches: 2 } },
} satisfies Record<string, Rule>;

// ── The ledger ────────────────────────────────────────────────────────────

export type Act =
  | "assert"   // X did Y on Z. Opens a claim.
  | "amend"    // a correction: a new claim that supersedes a settled one, with a reason
  | "confirm"  // the person named says yes, that was me
  | "vouch"    // another member says yes, I can stand behind this
  | "object"   // a member says no, with a reason. Pauses the claim until resolved
  | "resolve"  // a steward or the profile's governance rules on one objection
  | "withdraw" // the asserter or the person named pulls it before it settles
  | "apply"    // the server has written what the settled claim changes (a Seed file, a credit panel)
  | "anchor";  // the settled claim's digest is on chain

/** An actor is a member id in the collective (a handle, or an SS58 account). */
export type Actor = string;

export interface Evidence {
  who?: string;
  what: string;
  when?: string;
  ref?: string;
}

export interface Signature {
  /** "webauthn" (a passkey) or "sr25519" etc. Verifiers ignore schemes they do not know. */
  scheme: string;
  /** Over sha256(canonical(event without sig)), unless the scheme says otherwise. */
  [k: string]: unknown;
}

export interface Event {
  v: typeof VERSION;
  id: string;
  /** ISO-8601 UTC. */
  at: string;
  claim: string;
  act: Act;
  by: Actor;

  // assert and amend
  /** Open namespace: "identity", "credit", or anything a profile names. Unknown kinds are kept and shown. */
  kind?: string;
  /** Profile whose rule settles this kind, e.g. "chaos-sessions", "fttf". */
  profile?: string;
  /** Who the claim is about. Empty string = a known role nobody has filled. */
  subject?: string;
  /** What they did: "is", "Camera Operator", "wrote". */
  relation?: string;
  /** What it was done on or to: a Seed slug, a film id, a CID. */
  target?: string;
  /** Explicit end of the window. Never earlier than the rule allows. */
  until?: string;
  evidence?: Evidence[];
  /** On amend: the claim this one replaces. */
  supersedes?: string;
  /** On amend, object, withdraw: why. Required on amend and object. */
  reason?: string;

  // resolve
  objection?: string;
  outcome?: "upheld" | "dismissed";

  // anchor
  chain?: { network: string; community?: number; block?: number; extrinsic?: string; digest: string };

  note?: string;
  sig?: Signature;
  /** Profile-specific fields. Kept verbatim, never read by the fold. */
  ext?: Record<string, unknown>;
}

// ── The fold ──────────────────────────────────────────────────────────────

export type State = "open" | "disputed" | "settled" | "rejected" | "withdrawn" | "superseded";

/** What an open claim is waiting for. */
export type Waiting = "confirm" | "vouches" | "window" | "objection" | null;

export interface Objection { id: string; by: Actor; at: string; reason: string; outcome?: "upheld" | "dismissed" }

export interface Claim {
  id: string;
  kind: string;
  profile: string;
  subject: string;
  relation: string;
  target: string;
  assertedBy: Actor;
  assertedAt: string;
  /** When the window closes. Equal to assertedAt when there is no window. */
  until: string;
  confirmedBy?: Actor;
  vouchedBy: Actor[];
  objections: Objection[];
  evidence: Evidence[];
  supersedes?: string;
  supersededBy?: string;
  reason?: string;
  state: State;
  waiting: Waiting;
  settledAt?: string;
  appliedAt?: string;
  anchor?: Event["chain"];
  events: Event[];
}

export type RuleBook = Record<string, Rule> | ((profile: string, kind: string) => Rule | undefined);

function ruleFor(book: RuleBook, c: Pick<Claim, "profile" | "kind">): Rule {
  const r = typeof book === "function" ? book(c.profile, c.kind) : book[`${c.profile}/${c.kind}`] ?? book[c.kind];
  if (!r) throw new Error(`no rule for ${c.profile}/${c.kind}`);
  return r;
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Fold a ledger into claims. Order is by `at`, then by position in the file.
 * The fold does not check who was allowed to do what. That is `may()`, at write
 * time. It only counts, so a ledger written by any honest server folds the same.
 */
export function fold(events: Event[], rules: RuleBook, now = Date.now()): Map<string, Claim> {
  const out = new Map<string, Claim>();
  const ordered = events.map((e, i) => [e, i] as const)
    .sort(([a, i], [b, j]) => (a.at < b.at ? -1 : a.at > b.at ? 1 : i - j))
    .map(([e]) => e);

  const flags = new Map<string, { withdrawn?: boolean; settledAt?: string }>();

  for (const e of ordered) {
    let c = out.get(e.claim);
    if (e.act === "assert" || e.act === "amend") {
      if (c && !flags.get(c.id)?.withdrawn) { c.events.push(e); continue; } // re-asserting a live claim changes nothing
      const at = Date.parse(e.at);
      const fresh: Claim = {
        id: e.claim,
        kind: e.kind ?? "",
        profile: e.profile ?? "",
        subject: e.subject ?? "",
        relation: e.relation ?? "",
        target: e.target ?? "",
        assertedBy: e.by,
        assertedAt: e.at,
        until: e.at,
        vouchedBy: [],
        objections: [],
        evidence: e.evidence ?? [],
        supersedes: e.act === "amend" ? e.supersedes : undefined,
        reason: e.reason,
        state: "open",
        waiting: null,
        events: c ? [...c.events, e] : [e],
      };
      const rule = ruleFor(rules, fresh);
      const window = fresh.supersedes ? rule.amend.window : rule.window;
      const floor = at + window * 1000;
      fresh.until = iso(Math.max(floor, e.until ? Date.parse(e.until) : 0));
      out.set(e.claim, fresh);
      flags.set(e.claim, {});
      continue;
    }
    if (!c) continue; // an event about nothing
    const f = flags.get(c.id)!;
    const rule = ruleFor(rules, c);
    // Time passing settles an optimistic claim, so check before this event lands:
    // an objection that arrives after the window closed is too late.
    settleIfDue(c, rule, f, Date.parse(e.at));
    c.events.push(e);
    switch (e.act) {
      case "confirm":
        if (!c.confirmedBy) c.confirmedBy = e.by;
        break;
      case "vouch":
        if (!c.vouchedBy.includes(e.by)) c.vouchedBy.push(e.by);
        break;
      case "object":
        c.objections.push({ id: e.id, by: e.by, at: e.at, reason: e.reason ?? "" });
        break;
      case "resolve": {
        const o = c.objections.find((x) => x.id === e.objection);
        if (o && !o.outcome) o.outcome = e.outcome;
        break;
      }
      case "withdraw":
        if (!f.settledAt) f.withdrawn = true;
        break;
      case "apply":
        c.appliedAt = c.appliedAt ?? e.at;
        break;
      case "anchor":
        c.anchor = e.chain;
        break;
    }
    // A vouch or a confirmation can be the act that settles a witnessed claim.
    settleIfDue(c, rule, f, Date.parse(e.at));
  }

  for (const c of out.values()) {
    const f = flags.get(c.id)!;
    const rule = ruleFor(rules, c);
    if (f.withdrawn) { c.state = "withdrawn"; c.waiting = null; continue; }
    if (f.settledAt) { c.state = "settled"; c.waiting = null; c.settledAt = f.settledAt; continue; }
    settleIfDue(c, rule, f, now);
    if (f.settledAt) { c.state = "settled"; c.waiting = null; c.settledAt = f.settledAt; continue; }
    const s = status(c, rule, now);
    c.state = s.state;
    c.waiting = s.waiting;
  }

  // A settled correction retires the claim it names. Nothing else does.
  for (const c of out.values()) {
    if (c.state !== "settled" || !c.supersedes) continue;
    const old = out.get(c.supersedes);
    if (old) { old.state = "superseded"; old.supersededBy = c.id; old.waiting = null; }
  }
  return out;
}

function vouchesNeeded(c: Claim, r: Rule): number {
  return c.supersedes ? r.amend.vouches : r.vouches;
}

function status(c: Claim, r: Rule, now: number): { state: State; waiting: Waiting } {
  if (c.objections.some((o) => o.outcome === "upheld")) return { state: "rejected", waiting: null };
  if (c.objections.some((o) => !o.outcome)) return { state: "disputed", waiting: "objection" };
  if (r.confirm && c.subject && !c.confirmedBy) return { state: "open", waiting: "confirm" };
  if (countVouches(c) < vouchesNeeded(c, r)) return { state: "open", waiting: "vouches" };
  if (now < Date.parse(c.until)) return { state: "open", waiting: "window" };
  return { state: "settled", waiting: null };
}

/** Vouches from the asserter or the confirmer do not count: three parties, one gesture each. */
function countVouches(c: Claim): number {
  return c.vouchedBy.filter((v) => v !== c.assertedBy && v !== c.confirmedBy).length;
}

/**
 * Settling is decided as of each moment, so a claim that settled stays settled
 * whatever is said about it afterwards. After that only a correction moves it.
 * It settles at the later of the act that completed it and the end of its window.
 */
function settleIfDue(c: Claim, r: Rule, f: { withdrawn?: boolean; settledAt?: string }, at: number) {
  if (f.settledAt || f.withdrawn) return;
  if (status(c, r, at).state !== "settled") return;
  const last = c.events[c.events.length - 1].at;
  f.settledAt = last > c.until ? last : c.until;
}

// ── Who may do what ───────────────────────────────────────────────────────
// One place, so a server, an app and a script refuse the same things.

export type Gate = { ok: true } | { ok: false; why: string };

export function may(act: Act, c: Claim | undefined, who: Actor, rules: RuleBook): Gate {
  if (act === "assert") return c && c.state !== "withdrawn" ? { ok: false, why: "this has already been said" } : { ok: true };
  if (!c) return { ok: false, why: "there is no such claim" };
  const live = c.state === "open" || c.state === "disputed";
  switch (act) {
    case "amend":
      return c.state === "settled" ? { ok: true } : { ok: false, why: "only a settled claim is corrected, and an open one can be objected to" };
    case "confirm":
      if (!live) return { ok: false, why: `this is ${c.state}` };
      if (c.confirmedBy) return { ok: false, why: "already confirmed" };
      if (who === c.assertedBy) return { ok: false, why: "whoever said it cannot also be the one who confirms it" };
      if (c.subject && c.subject !== c.assertedBy && who !== c.subject) return { ok: false, why: "only the person named confirms" };
      return { ok: true };
    case "vouch":
      if (!live) return { ok: false, why: `this is ${c.state}` };
      if (who === c.assertedBy || who === c.confirmedBy) return { ok: false, why: "a vouch has to come from a third person" };
      if (c.vouchedBy.includes(who)) return { ok: false, why: "you have already vouched for this" };
      return { ok: true };
    case "object":
      if (!live) return { ok: false, why: c.state === "settled" ? "it has settled, so propose a correction instead" : `this is ${c.state}` };
      if (who === c.assertedBy) return { ok: false, why: "withdraw it instead" };
      if (c.objections.some((o) => o.by === who && !o.outcome)) return { ok: false, why: "you already have an objection open" };
      return { ok: true };
    case "resolve":
      return c.objections.some((o) => !o.outcome) ? { ok: true } : { ok: false, why: "nothing to resolve" };
    case "withdraw":
      if (!live) return { ok: false, why: `this is ${c.state}` };
      return who === c.assertedBy || who === c.subject ? { ok: true } : { ok: false, why: "only whoever said it, or the person named, withdraws it" };
    case "apply":
      return c.state === "settled" && !c.appliedAt ? { ok: true } : { ok: false, why: "only a settled claim is applied, once" };
    case "anchor":
      return c.state === "settled" && !c.anchor ? { ok: true } : { ok: false, why: "only a settled claim goes on chain, once" };
  }
}

// ── What members see ──────────────────────────────────────────────────────

/** The collective's open list: everything a member could still object to or vouch for. */
export function openClaims(claims: Iterable<Claim>): Claim[] {
  return [...claims].filter((c) => c.state === "open" || c.state === "disputed")
    .sort((a, b) => (a.until < b.until ? -1 : 1));
}

/** One member's record: what they said, what names them, what waits on them. */
export function recordOf(claims: Iterable<Claim>, who: Actor) {
  const all = [...claims];
  return {
    made: all.filter((c) => c.assertedBy === who),
    aboutMe: all.filter((c) => c.subject === who && c.assertedBy !== who),
    waitingOnMe: all.filter((c) => c.state === "open" && c.waiting === "confirm" && c.subject === who),
  };
}

// ── Canonical bytes and the anchor digest ─────────────────────────────────

/** JSON with sorted keys and no whitespace. What a signature and a digest are taken over. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => (v as any)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The bytes an event's signature covers. */
export function signingBytes(e: Event): string {
  const { sig: _sig, ...rest } = e;
  return canonical(rest);
}

/**
 * What goes on chain for a settled claim: the claim as settled, and the ids of
 * the events that settled it. Not the evidence, not the notes, not the objections.
 * Anyone holding the ledger can recompute it. Nobody holding only the chain learns
 * what it says.
 */
export function anchorPayload(c: Claim): string {
  if (c.state !== "settled" && c.state !== "superseded") throw new Error(`claim ${c.id} is ${c.state}`);
  return canonical({
    v: VERSION, claim: c.id, kind: c.kind, profile: c.profile,
    subject: c.subject, relation: c.relation, target: c.target,
    supersedes: c.supersedes, settledAt: c.settledAt,
    events: c.events.filter((e) => e.act !== "anchor" && e.act !== "apply").map((e) => e.id),
  });
}

export async function anchorDigest(c: Claim): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(anchorPayload(c)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Parsing ───────────────────────────────────────────────────────────────

export function parseLedger(text: string): Event[] {
  const out: Event[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && e.v === VERSION && e.claim && e.act && e.at && e.by !== undefined) out.push(e);
    } catch {}
  }
  return out;
}

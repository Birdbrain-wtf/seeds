#!/usr/bin/env python3
"""Aggregate per-session speaker_maps + mentions into a single attendee graph.
Output: vault/calls/chaos-sessions/_attendees.yaml
"""
import os
import yaml, glob, re
from collections import defaultdict
from pathlib import Path

ROOT = Path(os.environ.get("SEEDS_SESSIONS", "vault/calls/chaos-sessions"))

# Hand-curated alias map. canonical_name -> [aliases]
ALIASES = {
    "Richard Welsh": ["richard", "rich", "rw", "welsh", "richard welsh"],
    "Vinay Gupta":   ["vinay", "vinay gupta"],
    "Daniel":        ["daniel", "dan"],
    "James Payne":   ["james payne", "james", "james5"],
    "Mikhail":       ["mikhail", "misha"],
    "Mykyta":        ["mykyta", "makita"],
    "Florentina":    ["florentina", "flo"],
    "Jordan":        ["jordan"],
    "Jonathan":      ["jonathan", "jon", "johnny"],
    "David":         ["david", "dave"],
    "Aytug":         ["aytug", "aitu", "aitur"],
    "Ankur":         ["ankur"],
    "Brenzi":        ["brenzi", "brenzy"],
    "Flipchan":      ["flipchan", "flip chan"],
    "Karam":         ["karam", "karim", "karim jedda"],
    "Gavin Wood":    ["gavin", "gavin wood"],
    "Coleman":       ["coleman"],
    "Anton":         ["anton"],
    "Lorena":        ["lorena"],
    "Pedro":         ["pedro"],
    "Finnegan":      ["finnegan"],
    "Michiel":       ["michiel"],
}

DOMAINS = {
    "Aytug":   {"projects": ["Chimera"], "context": "Formal verification"},
    "Ankur":   {"projects": ["Papillae"], "context": ""},
    "Brenzi":  {"projects": ["Encointer"], "context": "Curator of the Kusama Proof-of-Personhood bounty"},
    "Karam":   {"projects": ["discourse-polkadot-auth"], "context": "Wallet auth plugin for Discourse"},
}

def canonical(name: str) -> str:
    if not name or name.lower() == "unknown":
        return None
    n = name.strip().lower()
    for canon, als in ALIASES.items():
        if n in als or n == canon.lower():
            return canon
    return name.strip().title()  # fallback: title-case unknown name

def main():
    attended = defaultdict(set)  # name -> set of CS ids where they spoke
    mentioned = defaultdict(set)
    action_items = defaultdict(int)

    for cs_dir in sorted(ROOT.glob("CS*")):
        cs = cs_dir.name
        # speaker_map → attended
        smp = cs_dir / "extract/en/speaker_map.yaml"
        if smp.exists():
            sm = yaml.safe_load(smp.read_text()) or {}
            for _, n in sm.items():
                c = canonical(n)
                if c: attended[c].add(cs)
        # mentions
        m = cs_dir / "extract/en/mentions.yaml"
        if m.exists():
            for mention in (yaml.safe_load(m.read_text()) or []):
                c = canonical(mention.get("name", ""))
                if c and cs not in attended.get(c, set()):
                    mentioned[c].add(cs)
        # summary action items (named bold headers)
        summ = cs_dir / "summary.md"
        if summ.exists():
            for h in re.findall(r"##### \*\*([^*]+)\*\*", summ.read_text()):
                c = canonical(h)
                if c: action_items[c] += 1

    out = {"attendees": []}
    all_people = set(attended) | set(mentioned)
    for p in sorted(all_people, key=lambda x: (-len(attended.get(x, set())), x)):
        a = sorted(attended.get(p, set()))
        m = sorted(mentioned.get(p, set()) - set(a))
        ai = action_items.get(p, 0)
        if p == "Richard Welsh":
            conf = "confirmed"
        elif len(a) >= 3 and ai >= 3:
            conf = "high"
        elif len(a) >= 2:
            conf = "medium"
        elif len(a) == 1:
            conf = "low"
        else:
            conf = "mentioned-only"
        aliases = ALIASES.get(p, [p.lower()])
        out["attendees"].append({
            "name": p,
            "aliases": aliases,
            "sessions_attended": a,
            "sessions_mentioned": m,
            "action_item_count": ai,
            "confidence": conf,
        })

    outpath = ROOT / "_attendees.yaml"
    outpath.write_text(yaml.safe_dump(out, sort_keys=False, allow_unicode=True))

    # Pretty-print summary
    by_conf = defaultdict(list)
    for a in out["attendees"]:
        by_conf[a["confidence"]].append(a)
    print(f"=== Attendee graph ({len(out['attendees'])} unique people) ===\n")
    for tier in ["confirmed", "high", "medium", "low", "mentioned-only"]:
        people = by_conf.get(tier, [])
        if not people: continue
        print(f"\n{tier.upper()} ({len(people)})")
        for a in people:
            att = len(a["sessions_attended"]); ment = len(a["sessions_mentioned"]); ai = a["action_item_count"]
            print(f"  {a['name']:25}  attended:{att:2}  mentioned:{ment:2}  action-items:{ai:2}")
    print(f"\nWrote: {outpath}")

if __name__ == "__main__":
    main()

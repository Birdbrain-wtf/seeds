#!/usr/bin/env python3
"""Distribute stage — fan extracts out into Birdbrain's queryable structures.

Reads:
  core/vault/calls/chaos-sessions/_attendees.yaml
  core/vault/calls/chaos-sessions/CS*/extract/en/*.yaml

Writes:
  core/vault/seeds/<slug>.md                — one per attended person
  core/vault/concepts/<slug>.md             — promoted (>=2 sessions)
  core/vault/concepts/_provisional/<slug>.md — first appearance
  core/vault/calls/chaos-sessions/_edges.yaml — typed graph edges
  core/vault/calls/chaos-sessions/_edges.json — graph edges (JSON for zo.space API)
"""
import os, yaml, re, json
from pathlib import Path
from collections import defaultdict


# === Privacy: pseudonymous-by-default per Decision 0004 ===
PSEUDONYM_MODE = False
ROOT = Path(os.environ.get("SEEDS_VAULT", "vault"))
SESS = ROOT / "calls/chaos-sessions"
SEEDS = ROOT / "seeds"
CONCEPTS = ROOT / "concepts"
PROVIS = CONCEPTS / "_provisional"

for d in (SEEDS, CONCEPTS, PROVIS):
    d.mkdir(parents=True, exist_ok=True)

DOMAINS = {
    "Aytug":   {"projects": ["Chimera"], "context": "Formal verification"},
    "Ankur":   {"projects": ["Papillae"], "context": ""},
    "Brenzi":  {"projects": ["Encointer"], "context": "Curator of the Kusama Proof-of-Personhood bounty"},
    "Karam":   {"projects": ["discourse-polkadot-auth"], "context": "Wallet auth plugin for Discourse"},
    "Richard Welsh": {"projects": ["Birdbrain"], "context": "Host of Chaos Sessions"},
}


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s


def yaml_block(d: dict) -> str:
    return "---\n" + yaml.safe_dump(d, sort_keys=False, allow_unicode=True) + "---\n"


# ===== SEEDS =====
attendees = (yaml.safe_load((SESS / "_attendees.yaml").read_text()) or {}).get("attendees", [])

# Name resolution: map attendance.json display names onto canonical attendee names.
NAME_INDEX = {}
for _a in attendees:
    NAME_INDEX[_a["name"].lower()] = _a["name"]
    for _al in (_a.get("aliases") or []):
        NAME_INDEX[_al.lower()] = _a["name"]

def resolve_name(display):
    if not display:
        return display
    d = display.strip()
    if d.lower() in NAME_INDEX:
        return NAME_INDEX[d.lower()]
    base = re.split(r"[(|]", d)[0].strip().lower()  # "Tony | Fangorn" / "Anton (Mattereum)"
    return NAME_INDEX.get(base, d.strip())

def load_attendance(cs_dir):
    af = cs_dir / "attendance.json"
    if not af.exists():
        return None
    try:
        return json.loads(af.read_text())
    except Exception:
        return None

# Topic tags per person (derived from sessions they attended)
person_topics = defaultdict(lambda: defaultdict(int))
person_quotes = defaultdict(list)
for cs_dir in sorted(SESS.glob("CS*")):
    if cs_dir.name.startswith("_"): continue
    smp = cs_dir / "extract/en/speaker_map.yaml"
    if not smp.exists(): continue
    sm = yaml.safe_load(smp.read_text()) or {}
    speaker_to_name = {sp: name for sp, name in sm.items()}
    topics_f = cs_dir / "extract/en/topics.yaml"
    topics = (yaml.safe_load(topics_f.read_text()) or []) if topics_f.exists() else []
    quotes_f = cs_dir / "extract/en/quotes.yaml"
    quotes = (yaml.safe_load(quotes_f.read_text()) or []) if quotes_f.exists() else []
    for q in quotes:
        sp = q.get("speaker", "")
        if sp and q.get("importance") == "high":
            person_quotes[sp].append({"session": cs_dir.name, "timestamp": q.get("timestamp"), "text": q.get("text")})
    # apply session topics to every speaker in that session
    for _, name in sm.items():
        for t in topics:
            person_topics[name][t["tag"]] += 1

seeds_written = 0
for att in attendees:
    name = att["name"]
    if att["confidence"] not in ("confirmed", "high", "medium", "low"):
        continue  # skip mentioned-only for now
    s = slug(name)
    domain = DOMAINS.get(name, {})
    fm = {
        "type": "seed",
        "slug": s,
        "display_name": name,
        "aliases": att.get("aliases", []),
        "address": None,
        "status": "inferred",
        "confidence": att["confidence"],
        "projects": domain.get("projects", []),
        "context": domain.get("context", ""),
        "sessions_attended": att["sessions_attended"],
        "sessions_mentioned_in": att.get("sessions_mentioned", []),
        "action_item_count": att.get("action_item_count", 0),
    }
    top_tags = sorted(person_topics[name].items(), key=lambda x: -x[1])[:8]
    top_quotes = person_quotes.get(name, [])[:3]
    body = f"# {name}\n\n"
    if domain.get("context"):
        body += f"_{domain['context']}_\n\n"
    body += "## Attendance\n\n"
    for sid in att["sessions_attended"]:
        body += f"- [[{sid}]]\n"
    body += "\n## Topic profile\n\n"
    for tag, n in top_tags:
        body += f"- `{tag}` ({n} sessions)\n"
    if top_quotes:
        body += "\n## Notable utterances\n\n"
        for q in top_quotes:
            body += f"> {q['text']}\n>\n> — [[{q['session']}]] @ {q['timestamp']}\n\n"
    body += "\n## Provenance\n\n"
    body += "All facts derived from witnessed events in `core/vault/calls/chaos-sessions/`. "
    body += "This is the collective's witness record — Birdbrain's slice of this person's identity. "
    body += "The canonical Seed lives (or will live) on the person's own Zo Computer.\n\n"
    body += "**To claim this Seed**: sign in via passkey Connect once it is live; the system will\n"
    body += "match this name against your Kreivo address and let you take ownership.\n"
    (SEEDS / f"{s}.md").write_text(yaml_block(fm) + body)
    seeds_written += 1

# ===== CONCEPTS =====
concept_appearances = defaultdict(list)  # canonical_name -> [{session, summary, first_speaker, timestamp}]
for cs_dir in sorted(SESS.glob("CS*")):
    if cs_dir.name.startswith("_"): continue
    cf = cs_dir / "extract/en/concepts.yaml"
    if not cf.exists(): continue
    concepts = yaml.safe_load(cf.read_text()) or []
    for c in concepts:
        name = c.get("name", "").strip()
        if not name: continue
        canonical = slug(name)
        concept_appearances[canonical].append({
            "session": cs_dir.name,
            "raw_name": name,
            "summary": c.get("summary", ""),
            "first_speaker": c.get("first_speaker", ""),
            "timestamp": c.get("timestamp", ""),
        })

concepts_promoted = 0
concepts_provisional = 0
for s, apps in concept_appearances.items():
    sessions = [a["session"] for a in apps]
    promoted = len(set(sessions)) >= 2
    fm = {
        "type": "concept",
        "slug": s,
        "status": "promoted" if promoted else "provisional",
        "first_seen": min(sessions),
        "appears_in": sorted(set(sessions)),
        "first_speaker": apps[0].get("first_speaker"),
    }
    raw_name = apps[0]["raw_name"]
    body = f"# {raw_name}\n\n"
    body += f"> {apps[0]['summary']}\n\n"
    body += "## Appearances\n\n"
    for a in apps:
        body += f"- [[{a['session']}]] @ {a['timestamp']}"
        if a["first_speaker"]:
            body += f" — first surfaced by {a['first_speaker']}"
        body += f"\n  _{a['summary']}_\n"
    target = (CONCEPTS / f"{s}.md") if promoted else (PROVIS / f"{s}.md")
    target.write_text(yaml_block(fm) + body)
    if promoted: concepts_promoted += 1
    else: concepts_provisional += 1

# ===== EDGES =====
edges = []
co_attendance = defaultdict(set)
session_speakers = {}
for cs_dir in sorted(SESS.glob("CS*")):
    if cs_dir.name.startswith("_"): continue
    smp = cs_dir / "extract/en/speaker_map.yaml"
    if not smp.exists(): continue
    sm = yaml.safe_load(smp.read_text()) or {}
    raw_names = [n for n in sm.values() if n and n != "unknown"]
    # Attended-unrecorded sessions: the signed passkey roster is the authoritative
    # presence signal — fuller and higher-provenance than the reconstructed speaker_map.
    _att = load_attendance(cs_dir)
    if _att and _att.get("attendees"):
        _roster = [resolve_name(p.get("display_name")) for p in _att["attendees"]]
        raw_names = [n for n in _roster if n and n != "unknown"]
    speakers = [f"Speaker {i+1}" for i in range(len(raw_names))] if PSEUDONYM_MODE else raw_names
    session_speakers[cs_dir.name] = speakers
    # co-attended pairs
    for i, a in enumerate(speakers):
        for b in speakers[i+1:]:
            pair = tuple(sorted([a, b]))
            co_attendance[pair].add(cs_dir.name)
    # mentioned edges
    mf = cs_dir / "extract/en/mentions.yaml"
    if mf.exists():
        for m in (yaml.safe_load(mf.read_text()) or []):
            target_name = m.get("name", "")
            by = m.get("referenced_by", "")
            if target_name and by:
                edges.append({
                    "type": "mentioned",
                    "by": by,
                    "target": target_name,
                    "session": cs_dir.name,
                    "context": (m.get("context") or "")[:140],
                })
    # quote edges
    qf = cs_dir / "extract/en/quotes.yaml"
    if qf.exists():
        for q in (yaml.safe_load(qf.read_text()) or []):
            sp = q.get("speaker", "")
            if sp:
                edges.append({
                    "type": "quoted-in",
                    "person": sp,
                    "session": cs_dir.name,
                    "timestamp": q.get("timestamp"),
                    "importance": q.get("importance"),
                })

for (a, b), sessions in co_attendance.items():
    edges.append({
        "type": "co-attended",
        "a": a, "b": b,
        "sessions": sorted(sessions),
        "count": len(sessions),
    })

(SESS / "_edges.yaml").write_text(yaml.safe_dump(
    {"edges": edges, "session_speakers": session_speakers},
    sort_keys=False, allow_unicode=True
))

# ===== REPORT =====
print(f"=== DISTRIBUTE COMPLETE ===\n")
print(f"Seeds written:         {seeds_written}  → core/vault/seeds/")
print(f"Concepts promoted:     {concepts_promoted}  → core/vault/concepts/")
print(f"Concepts provisional:  {concepts_provisional}  → core/vault/concepts/_provisional/")
print(f"Graph edges:           {len(edges)}  → core/vault/calls/chaos-sessions/_edges.yaml")
print(f"  · co-attended:       {sum(1 for e in edges if e['type']=='co-attended')}")
print(f"  · mentioned:         {sum(1 for e in edges if e['type']=='mentioned')}")
print(f"  · quoted-in:         {sum(1 for e in edges if e['type']=='quoted-in')}")
print(f"Graph edges (JSON):    {len(edges)}  → core/vault/calls/chaos-sessions/_edges.json")

# ===== SNAPSHOT for the /chaos page =====
import json as _json



def _visual_story_langs(cs_dir):
    ex = cs_dir / "extract"
    if not ex.exists(): return []
    return sorted([d.name for d in ex.iterdir() if d.is_dir() and (d / "visual-story.pdf").exists()])

def _get_duration(cs_dir, meta):
    if meta.get("duration_minutes"): return meta["duration_minutes"]
    # Try summary.md frontmatter
    sf = cs_dir / "summary.md"
    if sf.exists():
        txt = sf.read_text()
        m = re.match(r"---\n([\s\S]*?)\n---", txt)
        if m:
            try:
                fm = yaml.safe_load(m.group(1)) or {}
                if fm.get("duration_minutes"): return fm["duration_minutes"]
            except Exception: pass
    # Try transcript.md frontmatter
    tf = cs_dir / "transcript.md"
    if tf.exists():
        txt = tf.read_text(errors="ignore")[:2000]
        m = re.match(r"---\n([\s\S]*?)\n---", txt)
        if m:
            try:
                fm = yaml.safe_load(m.group(1)) or {}
                if fm.get("duration_minutes"): return fm["duration_minutes"]
            except Exception: pass
    return None

sessions_data = []
for cs_dir in sorted(SESS.glob("CS*")):
    if cs_dir.name.startswith("_"): continue
    meta = yaml.safe_load((cs_dir / "metadata.yaml").read_text()) if (cs_dir / "metadata.yaml").exists() else {}
    combined_f = cs_dir / "extract/en/combined.yaml"
    combined = yaml.safe_load(combined_f.read_text()) if combined_f.exists() else {}
    tx = cs_dir / "transcript.md"
    transcript_real = tx.exists() and tx.stat().st_size > 100
    sig_dir = Path(os.environ.get("SEEDS_SIGNAL", "signal/chaos-sessions")) / cs_dir.name / "raw"
    _att = load_attendance(cs_dir)
    _prov = (combined.get("_provenance") or {}) if combined else {}
    _meta_status = meta.get("status")
    # An explicit "unrecorded" status must win even when a (reconstructed) extract exists.
    _status = _meta_status if _meta_status == "unrecorded" else ("complete" if combined else (_meta_status or "ingested"))
    # Attendance has two schemas: reconstructed (display_name + top-level count) and
    # live passkey logins from chaos-auth (displayName, no count, one row per login incl. re-joins).
    if _att:
        _roster, _seen = [], set()
        for p in (_att.get("attendees") or []):
            nm = resolve_name(p.get("display_name") or p.get("displayName"))
            if not nm:
                continue
            key = nm.strip().lower()
            if key in _seen:
                continue
            _seen.add(key)
            _roster.append(nm)
        _att_names = _roster
        _att_count = _att.get("count") or len(_roster)
        _att_source = _att.get("source") or next((p.get("method") for p in (_att.get("attendees") or []) if p.get("method")), None)
    else:
        _att_names, _att_count, _att_source = None, None, None
    sessions_data.append({
        "id": cs_dir.name,
        "date": meta.get("date"),
        "title": meta.get("title"),
        "status": _status,
        "recording": meta.get("recording"),
        "reconstructed": bool(_prov),
        "provenance": _prov or None,
        "attendance_count": _att_count,
        "attendance_source": _att_source,
        "attendance_names": _att_names,
        "duration_minutes": _get_duration(cs_dir, meta),
        "fireflies_id": meta.get("fireflies_id"),
        "recording_change": meta.get("recording_change"),
        "frame": (combined.get("frame") or {}).get("text"),
        "topics": [t.get("tag") for t in (combined.get("topics") or [])],
        "speaker_count": len(combined.get("speaker_map") or {}),
        "counts": {
            "topics": len(combined.get("topics") or []),
            "quotes": len(combined.get("quotes") or []),
            "mentions": len(combined.get("mentions") or []),
            "decisions": len(combined.get("decisions") or []),
            "questions": len(combined.get("questions") or []),
            "concepts": len(combined.get("concepts") or []),
        },
        "speaker_map": (
            {sp: f"Speaker {i+1}" for i, sp in enumerate(raw_sm)}
            if PSEUDONYM_MODE and (raw_sm := combined.get("speaker_map") or {})
            else (combined.get("speaker_map") or {})
        ),
        "modalities": {
            "transcript": bool(transcript_real),
            "visual_story": (cs_dir / "extract/en/visual-story.pdf").exists(),
            "visual_story_languages": _visual_story_langs(cs_dir),
            "audio": (sig_dir / "audio.mp3").exists(),
            "video": (sig_dir / "video.mp4").exists(),
        },
    })

promoted_concepts = []
for f in sorted(CONCEPTS.glob("*.md")):
    body = f.read_text()
    fm_m = re.match(r"---\n([\s\S]*?)\n---", body)
    fm = yaml.safe_load(fm_m.group(1)) if fm_m else {}
    summary_m = re.search(r"^> (.+)", body, flags=re.MULTILINE)
    promoted_concepts.append({
        "slug": fm.get("slug") or f.stem,
        "first_seen": fm.get("first_seen"),
        "appears_in": fm.get("appears_in") or [],
        "first_speaker": fm.get("first_speaker"),
        "summary": summary_m.group(1) if summary_m else "",
    })

provisional_top = []
prov_files = list(PROVIS.glob("*.md"))
for f in prov_files[:30]:
    body = f.read_text()
    fm_m = re.match(r"---\n([\s\S]*?)\n---", body)
    fm = yaml.safe_load(fm_m.group(1)) if fm_m else {}
    summary_m = re.search(r"^> (.+)", body, flags=re.MULTILINE)
    provisional_top.append({
        "slug": fm.get("slug") or f.stem,
        "first_seen": fm.get("first_seen"),
        "summary": (summary_m.group(1)[:160] if summary_m else "")
    })

open_questions = []
for cs_dir in sorted(SESS.glob("CS*")):
    if cs_dir.name.startswith("_"): continue
    qf = cs_dir / "extract/en/questions.yaml"
    if not qf.exists(): continue
    for q in (yaml.safe_load(qf.read_text()) or []):
        if isinstance(q, dict) and q.get("text"):
            open_questions.append({
                "session": cs_dir.name,
                "text": q["text"],
                "raised_by": q.get("raised_by"),
                "timestamp": q.get("timestamp"),
            })

attendees_yaml = yaml.safe_load((SESS / "_attendees.yaml").read_text()) or {}
attendees_list = attendees_yaml.get("attendees", [])

# Cross-session motifs (the semantic layer): picked up if semantic.py has run.
# Motifs are the differently-worded-but-same-idea threads that exact concept
# recurrence misses — see core/vault/scripts/chaos-sessions/semantic.py.
_motifs_f = SESS / "_semantic" / "motifs.json"
motifs_doc = _json.loads(_motifs_f.read_text()) if _motifs_f.exists() else {"motifs": []}
motifs = motifs_doc.get("motifs", [])

snapshot = {
    "intelligence": "Birdbrain",
    "jitsi_url": "https://cs.birdbrain.wtf/",
    "jitsi_hosting": "cs.birdbrain.wtf (self-hosted Jitsi; passkey-gated join via rw.zo.space/chaos/join; JWT-authenticated)",
    "channel": "Chaos Sessions",
    "cadence": "Mondays 15:00 UK",
    "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "sessions": sessions_data,
    "attendees": [
        {**a, "name": f"Participant {i+1}" if PSEUDONYM_MODE else a["name"]}
        for i, a in enumerate(attendees_list)
    ],
    "concepts": {
        "promoted": promoted_concepts,
        "provisional_top": provisional_top,
        "provisional_count": len(prov_files),
    },
    "open_questions": open_questions[:50],
    "motifs": motifs,
    "counts": {
        "sessions": len(sessions_data),
        "attendees": sum(1 for a in attendees_list if a.get("confidence") != "mentioned-only"),
        "mention_only": sum(1 for a in attendees_list if a.get("confidence") == "mentioned-only"),
        "promoted_concepts": len(promoted_concepts),
        "provisional_concepts": len(prov_files),
        "open_questions": len(open_questions),
        "motifs": len(motifs),
    },
}

(SESS / "_chaos-snapshot.json").write_text(_json.dumps(snapshot, ensure_ascii=False, indent=2, default=str))
(SESS / "_edges.json").write_text(_json.dumps({"edges": edges, "session_speakers": session_speakers}, ensure_ascii=False, indent=2, default=str))

# Per-session JSON: includes the FULL extract for the detail page
for _sd in sessions_data:
    _cs_dir = SESS / _sd["id"]
    _combined_f = _cs_dir / "extract/en/combined.yaml"
    _combined = yaml.safe_load(_combined_f.read_text()) if _combined_f.exists() else {}
    _detail = {**_sd, "extract": _combined}
    (_cs_dir / "_session.json").write_text(_json.dumps(_detail, ensure_ascii=False, default=str))
print(f"Per-session JSON:      {len(sessions_data)} files")

print(f"\nSnapshot:              {len(_json.dumps(snapshot, default=str))} bytes  → _chaos-snapshot.json")

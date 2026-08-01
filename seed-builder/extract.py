#!/usr/bin/env python3
"""
Chaos Sessions — Extract stage.

Reads a session's transcript + summary, sends them to Zo for structured extraction,
writes per-section YAML files into CS{NN}/extract/<lang>/.

Idempotent: re-running overwrites the extract folder for that session+language.
Regenerable: delete the extract folder and re-run when extractor improves.

Usage:
    extract.py CS16                    # single session, English
    extract.py CS16 --lang es          # single session, Spanish
    extract.py --all                   # all sessions, English
    extract.py --all --parallel 4      # backfill, 4 in flight at once
"""
import argparse, asyncio, json, os, re, sys
from pathlib import Path
import aiohttp
import yaml

SESSIONS_ROOT = Path(os.environ.get("SEEDS_SESSIONS", "vault/calls/chaos-sessions"))
MODEL = os.environ.get("ZO_EXTRACT_MODEL", "byok:cb40b4af-1b7f-4288-af25-2df72a7b2378")
ZO_API = "https://api.zo.computer/zo/ask"
TOKEN = os.environ["ZO_CLIENT_IDENTITY_TOKEN"]

EXTRACT_SECTIONS = [
    "speaker_map",     # Speaker N → display_name (best inference)
    "frame",           # one-sentence crystallisation of the call
    "topics",          # 3-7 tag dicts with confidence + cross-session likelihood
    "quotes",          # 5-10 standalone quotes worth preserving
    "mentions",        # people referenced by name but not in attendance
    "decisions",       # commitments made
    "questions",       # threads left open
    "concepts",        # candidates for vault/concepts/
]

PROMPT_TEMPLATE = """You are extracting structured information from a Chaos Sessions transcript for the Birdbrain world model.

Chaos Sessions is a weekly Monday 15:00 UK call mixing inside + outside contributors. It's the highest-bandwidth signal channel for Birdbrain. Transcripts open with social warm-up (motorbikes, weather, family) before substantive discussion begins — your extractions should focus on the substantive material, not the chit-chat.

SESSION: {session_id}  ·  {date}

YOUR JOB:
Extract structured information across {n_sections} sections. Output a SINGLE JSON document with the keys listed below — and nothing else (no preamble, no markdown fence, no postscript, no trailing comments). All strings must be valid JSON strings (double-quoted, with internal double quotes and backslashes escaped). This matters: we parse the output with strict JSON.

REQUIRED OUTPUT SHAPE (JSON):

{{
  "speaker_map": {{ "Speaker 1": "<name or 'unknown'>", "Speaker 2": "...", ... }},
  "frame": {{ "text": "<one sentence, present tense, observational — a thesis not a recap>" }},
  "topics": [
    {{ "tag": "<kebab-case-tag>", "confidence": "high|medium|low",
       "cross_session_likely": true|false, "why": "<very brief>" }}
  ],
  "quotes": [
    {{ "speaker": "<name from speaker_map>", "timestamp": "<HH:MM:SS or MM:SS>",
       "text": "<quote, 1-3 sentences, no surrounding quotation marks>",
       "importance": "high|medium|low", "why": "<very brief>" }}
  ],
  "mentions": [
    {{ "name": "<person name>", "context": "<one sentence>",
       "referenced_by": "<name from speaker_map>" }}
  ],
  "decisions": [
    {{ "what": "<decision in present tense>", "by": "<name or 'All'>",
       "timestamp": "<HH:MM:SS>" }}
  ],
  "questions": [
    {{ "text": "<the question>", "raised_by": "<name from speaker_map>",
       "timestamp": "<HH:MM:SS>" }}
  ],
  "concepts": [
    {{ "name": "<kebab-case-name>", "summary": "<one sentence>",
       "first_speaker": "<name from speaker_map>", "timestamp": "<HH:MM:SS>" }}
  ]
}}

GUIDANCE:

- Cross-reference the transcript's "Speaker N" labels with names mentioned in the summary's action items. Use context (who speaks about what) to disambiguate. If you can't resolve a Speaker N, output "unknown".

- Frame: one present-tense, observational sentence. When the sentence needs to name the collective actor or intelligence, use "Birdbrain" (the world model) or "the Kusama-flock" — never the name of a brand built on top.

- Topics: 3-7 total. Prefer lowercase-hyphenated. `cross_session_likely: true` if it's the kind of theme that recurs across chaos sessions; `false` if one-off.

- Quotes: 5-10. Each a complete thought that stands alone. Skip pleasantries. Pick quotes that express a thesis, frame a tension, or capture distinctive voice.

- Mentions: people referenced by name but not in attendance (not in speaker_map). People only, not company/product names.

- Concepts: be conservative. Only things that could anchor future thinking. Skip obvious / well-known concepts.

LANGUAGE: all output in {language}. Tags and concept `name` fields stay lowercase-hyphenated English (these are queryable identifiers). Everything else in {language}.

--- SUMMARY (Fireflies; names speakers by their real names) ---

{summary_text}

--- TRANSCRIPT (Fireflies; speakers labelled as Speaker N) ---

{transcript_text}

--- END OF INPUT ---

Now produce ONLY the JSON document. No preamble, no markdown fence, no postscript."""


LANG_NAMES = {"en": "English", "es": "Spanish", "fr": "French", "de": "German"}


def read_session(session_id: str) -> tuple[str, str, dict]:
    folder = SESSIONS_ROOT / session_id
    transcript = (folder / "transcript.md").read_text(encoding="utf-8")
    summary = (folder / "summary.md").read_text(encoding="utf-8")
    meta = yaml.safe_load((folder / "metadata.yaml").read_text(encoding="utf-8"))
    return transcript, summary, meta


def build_prompt(session_id: str, lang: str) -> str:
    transcript, summary, meta = read_session(session_id)
    return PROMPT_TEMPLATE.format(
        session_id=session_id,
        date=meta.get("date", "unknown"),
        n_sections=len(EXTRACT_SECTIONS),
        language=LANG_NAMES.get(lang, lang),
        summary_text=summary,
        transcript_text=transcript,
    )


async def call_zo(session: aiohttp.ClientSession, prompt: str) -> str:
    async with session.post(
        ZO_API,
        headers={"authorization": TOKEN, "content-type": "application/json"},
        json={"input": prompt, "model_name": MODEL},
        timeout=aiohttp.ClientTimeout(total=600),
    ) as resp:
        data = await resp.json()
        return data["output"]


def strip_codefence(text: str) -> str:
    """If the model wrapped output in ```json/yaml ... ```, strip it."""
    text = text.strip()
    m = re.match(r"^```(?:json|yaml|yml)?\s*\n(.*?)\n```\s*$", text, re.DOTALL)
    return m.group(1).strip() if m else text


def parse_output(raw: str):
    """Parse the model's output. Prefer JSON; fall back to YAML for legacy compatibility."""
    stripped = strip_codefence(raw)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    return yaml.safe_load(stripped)


def write_extract(session_id: str, lang: str, parsed: dict) -> Path:
    extract_dir = SESSIONS_ROOT / session_id / "extract" / lang
    extract_dir.mkdir(parents=True, exist_ok=True)
    # Write one file per section + a combined.yaml for convenience
    for section in EXTRACT_SECTIONS:
        section_path = extract_dir / f"{section}.yaml"
        section_path.write_text(
            yaml.safe_dump(parsed.get(section, []), sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
    (extract_dir / "combined.yaml").write_text(
        yaml.safe_dump(parsed, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    return extract_dir


async def extract_one(http: aiohttp.ClientSession, session_id: str, lang: str) -> dict:
    prompt = build_prompt(session_id, lang)
    raw = await call_zo(http, prompt)
    try:
        parsed = parse_output(raw)
    except Exception as e:
        # Save raw for inspection
        debug = SESSIONS_ROOT / session_id / "extract" / lang / "_raw_output.txt"
        debug.parent.mkdir(parents=True, exist_ok=True)
        debug.write_text(raw, encoding="utf-8")
        return {"session": session_id, "ok": False, "error": f"parse: {e}", "raw_saved": str(debug)}
    out_dir = write_extract(session_id, lang, parsed)
    counts = {k: len(parsed.get(k, []) or []) if isinstance(parsed.get(k), list) else 1 for k in EXTRACT_SECTIONS}
    return {"session": session_id, "ok": True, "out_dir": str(out_dir), "counts": counts}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("session", nargs="?", help="e.g. CS16. Omit if using --all")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--parallel", type=int, default=4)
    args = ap.parse_args()

    if args.all:
        sessions = sorted(p.name for p in SESSIONS_ROOT.iterdir()
                          if p.is_dir() and re.match(r"CS\d{2}$", p.name))
    elif args.session:
        sessions = [args.session]
    else:
        ap.error("Pass a session id (e.g. CS16) or --all")

    sem = asyncio.Semaphore(args.parallel)
    async with aiohttp.ClientSession() as http:
        async def worker(sid):
            async with sem:
                print(f"  extracting {sid}…", flush=True)
                return await extract_one(http, sid, args.lang)
        results = await asyncio.gather(*[worker(s) for s in sessions])

    print("\n=== EXTRACT COMPLETE ===\n")
    for r in results:
        if r["ok"]:
            c = r["counts"]
            print(f"  ✓ {r['session']:5}  topics:{c['topics']:>2}  quotes:{c['quotes']:>2}  "
                  f"mentions:{c['mentions']:>2}  decisions:{c['decisions']:>2}  "
                  f"questions:{c['questions']:>2}  concepts:{c['concepts']:>2}")
        else:
            print(f"  ✗ {r['session']:5}  ERROR: {r['error']}")
    print()


if __name__ == "__main__":
    asyncio.run(main())

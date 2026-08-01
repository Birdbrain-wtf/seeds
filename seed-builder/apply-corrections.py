#!/usr/bin/env python3
"""Apply transcription corrections from _corrections.yaml across all canonical
chaos-sessions derived files. Idempotent. Does NOT touch original source data.

Usage:  python3 apply-corrections.py [--dry-run]
"""
import os
import sys, re, yaml
from pathlib import Path

ROOT = Path(os.environ.get("SEEDS_SESSIONS", "vault/calls/chaos-sessions"))
SEEDS = Path(os.environ.get("SEEDS_DIR", "vault/seeds"))
CONCEPTS = Path(os.environ.get("SEEDS_CONCEPTS", "vault/concepts"))
CORR_FILE = ROOT / "_corrections.yaml"

DRY = "--dry-run" in sys.argv

corrections = (yaml.safe_load(CORR_FILE.read_text()) or {}).get("corrections", [])
if not corrections:
    print("no corrections defined"); sys.exit(0)

# Build regex list. Case-insensitive by default, word-boundary-anchored.
patterns = []
for c in corrections:
    wrong = c["wrong"]
    right = c["right"]
    case_sensitive = c.get("case_sensitive", False)
    flags = 0 if case_sensitive else re.IGNORECASE
    pat = re.compile(rf"\b{re.escape(wrong)}\b", flags)
    patterns.append((pat, right, wrong))

targets = []
for d in [ROOT, SEEDS, CONCEPTS]:
    for ext in ("*.md", "*.yaml", "*.json"):
        for f in d.rglob(ext):
            # Skip archive (immutable) and corrections file itself
            if "_archive" in f.parts: continue
            if f.name == "_corrections.yaml": continue
            targets.append(f)

print(f"Scanning {len(targets)} files for {len(patterns)} correction(s)…")
print(f"Mode: {'DRY-RUN' if DRY else 'WRITE'}\n")

total_files = 0; total_subs = 0
by_correction = {c["wrong"]: 0 for c in corrections}

for f in targets:
    try:
        txt = f.read_text()
    except Exception:
        continue
    new = txt
    file_subs = 0
    for pat, right, wrong in patterns:
        new, n = pat.subn(right, new)
        if n:
            by_correction[wrong] += n
            file_subs += n
    if file_subs and new != txt:
        total_files += 1
        total_subs += file_subs
        if not DRY:
            f.write_text(new)

print(f"Files changed: {total_files}")
print(f"Total substitutions: {total_subs}")
for wrong, n in by_correction.items():
    if n: print(f"  · {wrong} → {next(c['right'] for c in corrections if c['wrong']==wrong)}: {n}")
print()
if DRY:
    print("(dry-run — no files written)")

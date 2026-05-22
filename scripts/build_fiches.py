"""Génère fiches markdown via Claude CLI à partir de cours-text/*.md.

Lit .todo_summarize.txt (ou --all), appelle `claude -p` pour chaque,
écrit fiches/<nom>.md, puis met à jour fiches/index.json.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT = ROOT / "cours-text"
FICHES = ROOT / "fiches"
PROMPT = (ROOT / "scripts" / "prompt_fiche.md").read_text()
CLAUDE_BIN = shutil.which("claude") or "claude"


def strip_md_fence(text: str) -> str:
    """Claude sometimes wraps its response in a ```markdown fence; strip it."""
    t = text.strip()
    if t.startswith("```"):
        # remove opening fence (optionally with language tag)
        first_nl = t.find("\n")
        if first_nl > 0:
            t = t[first_nl + 1:]
        # remove closing fence
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3].rstrip()
    return t.strip()


def run_claude(course_text: str, source_name: str) -> str:
    user_msg = f"{PROMPT}\n\n---\nNOM FICHIER SOURCE: {source_name}\n\n---\nTEXTE DU COURS:\n\n{course_text}"
    # `claude -p` runs in print/non-interactive mode and returns the response on stdout.
    proc = subprocess.run(
        [CLAUDE_BIN, "-p", "--output-format", "text"],
        input=user_msg,
        text=True,
        capture_output=True,
        timeout=600,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude failed (rc={proc.returncode}): {proc.stderr.strip()}")
    return strip_md_fence(proc.stdout)


def extract_flashcards(md: str) -> list[dict]:
    m = re.search(r"```json\s*(\[.*?\])\s*```", md, re.DOTALL)
    if not m:
        return []
    try:
        cards = json.loads(m.group(1))
        return cards if isinstance(cards, list) else []
    except json.JSONDecodeError:
        return []


RECAP_VOCAB = "_recap_vocabulaire"
RECAP_VERBS = "_recap_verbes"


def normalize_fr(s: str) -> str:
    """Sort key: lowercase, strip leading articles/quotes, accent-fold."""
    import unicodedata
    s = s.strip().lower()
    for prefix in ("le ", "la ", "les ", "l'", "un ", "une ", "des ", "à ", "au ", "aux "):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return s


def is_valid_entry(card: dict) -> bool:
    """Reject malformed flashcards: notes/sentences misclassified as vocab entries."""
    front = (card.get("front") or "").strip()
    back = (card.get("back") or "").strip()
    if not front or not back:
        return False
    if len(front) > 40 or len(back) > 60:
        return False
    if any(sep in front for sep in ("→", "=", "...")):
        return False
    if back.count(" ") > 6:   # back is a full sentence, not a translation
        return False
    return True


def is_verb(card: dict) -> bool:
    if not is_valid_entry(card):
        return False
    front = (card.get("front") or "").strip()
    # exclude exclamations/questions
    if any(p in front for p in "!?.,;:"):
        return False
    # require "å X" where X starts with a lowercase letter (real infinitive)
    lower = front.lower()
    if lower.startswith("å ") and len(lower) > 2 and lower[2].isalpha() and lower[2] == lower[2].lower():
        return True
    if card.get("type") == "verbe" or card.get("pos") == "verbe":
        # trust Claude's tag but still require front looks like infinitive
        return lower.startswith("å ") or lower.startswith("aa ")
    return False


def dedupe(cards: list[dict]) -> list[dict]:
    seen = {}
    for c in cards:
        key = (c.get("front", "").strip().lower(), c.get("back", "").strip().lower())
        if key not in seen:
            seen[key] = c
        else:
            # merge sources
            existing = seen[key]
            srcs = set(filter(None, [existing.get("source", ""), c.get("source", "")]))
            existing["source"] = ", ".join(sorted(srcs))
    return list(seen.values())


def build_recap_vocab(cards: list[dict]) -> str:
    vocab = [c for c in cards if is_valid_entry(c) and not is_verb(c) and c.get("type") in (None, "vocab", "verbe")]
    vocab = dedupe(vocab)
    vocab.sort(key=lambda c: normalize_fr(c.get("back", "")))
    lines = [
        "---",
        "title: Récapitulatif — Vocabulaire (A→Z français)",
        "kind: recap",
        f"updated: {__import__('datetime').date.today().isoformat()}",
        "---",
        "",
        "# 📚 Récapitulatif vocabulaire",
        "",
        f"_{len(vocab)} entrées, triées par traduction française. Auto-régénéré à chaque ajout de leçon._",
        "",
        "| Français | Norsk (bokmål) | Type | Source |",
        "|---|---|---|---|",
    ]
    for c in vocab:
        fr = c.get("back", "").replace("|", "\\|")
        no = c.get("front", "").replace("|", "\\|")
        t = c.get("pos", c.get("type", ""))
        src = c.get("source", "")
        lines.append(f"| {fr} | {no} | {t} | {src} |")
    return "\n".join(lines) + "\n"


def build_recap_verbs(cards: list[dict]) -> str:
    verbs = [c for c in cards if is_verb(c)]
    verbs = dedupe(verbs)
    verbs.sort(key=lambda c: normalize_fr(c.get("back", "")))
    lines = [
        "---",
        "title: Récapitulatif — Verbes (A→Z français)",
        "kind: recap",
        f"updated: {__import__('datetime').date.today().isoformat()}",
        "---",
        "",
        "# 🔁 Récapitulatif verbes",
        "",
        f"_{len(verbs)} verbes (infinitif), triés par traduction française. Auto-régénéré à chaque ajout de leçon._",
        "",
        "| Français | Infinitif norsk | Source |",
        "|---|---|---|",
    ]
    for c in verbs:
        fr = c.get("back", "").replace("|", "\\|")
        no = c.get("front", "").replace("|", "\\|")
        src = c.get("source", "")
        lines.append(f"| {fr} | {no} | {src} |")
    return "\n".join(lines) + "\n"


def update_index() -> None:
    """Aggregate all fiches into fiches/index.json (for PWA), regen recaps."""
    entries = []
    all_cards = []
    for fp in sorted(FICHES.glob("*.md")):
        if fp.stem.startswith("_recap_"):
            continue  # skip aggregated recaps, rebuilt below
        text = fp.read_text()
        fm = {}
        if text.startswith("---"):
            end = text.find("---", 3)
            if end > 0:
                raw_fm = text[3:end]
                for line in raw_fm.splitlines():
                    if ":" in line:
                        k, v = line.split(":", 1)
                        fm[k.strip()] = v.strip()
        cards = extract_flashcards(text)
        for c in cards:
            c["source"] = fp.stem
        all_cards.extend(cards)
        entries.append({
            "slug": fp.stem,
            "title": fm.get("title", fp.stem),
            "source": fm.get("source", ""),
            "themes": fm.get("themes", "[]"),
            "niveau": fm.get("niveau", ""),
            "path": f"fiches/{fp.name}",
            "card_count": len(cards),
            "kind": "lesson",
        })

    # Build recaps (always regenerated)
    recap_vocab_md = build_recap_vocab(all_cards)
    recap_verbs_md = build_recap_verbs(all_cards)
    (FICHES / f"{RECAP_VOCAB}.md").write_text(recap_vocab_md)
    (FICHES / f"{RECAP_VERBS}.md").write_text(recap_verbs_md)

    n_vocab = recap_vocab_md.count("\n| ") - 1  # rows minus header
    n_verbs = recap_verbs_md.count("\n| ") - 1
    entries.insert(0, {
        "slug": RECAP_VERBS, "title": "🔁 Verbes (A→Z FR)", "kind": "recap",
        "path": f"fiches/{RECAP_VERBS}.md", "card_count": n_verbs,
        "niveau": "", "themes": "", "source": "auto",
    })
    entries.insert(0, {
        "slug": RECAP_VOCAB, "title": "📚 Vocabulaire (A→Z FR)", "kind": "recap",
        "path": f"fiches/{RECAP_VOCAB}.md", "card_count": n_vocab,
        "niveau": "", "themes": "", "source": "auto",
    })

    (FICHES / "index.json").write_text(json.dumps({"fiches": entries}, ensure_ascii=False, indent=2))
    (FICHES / "flashcards.json").write_text(json.dumps(all_cards, ensure_ascii=False, indent=2))
    print(f"[fiches] index: {len(entries)} fiches, {len(all_cards)} cartes (recap vocab={n_vocab}, verbes={n_verbs})")


def main() -> int:
    todo = ROOT / "scripts" / ".todo_summarize.txt"
    if len(sys.argv) > 1 and sys.argv[1] == "--all":
        targets = [str(p.relative_to(TEXT)) for p in TEXT.rglob("*.md")]
    elif todo.exists():
        targets = [l for l in todo.read_text().splitlines() if l.strip()]
    else:
        print("[fiches] no todo and no --all")
        update_index()
        return 0

    if not targets:
        print("[fiches] nothing to summarize")
        update_index()
        return 0

    FICHES.mkdir(exist_ok=True)
    force = "--force" in sys.argv
    ok = 0
    skipped = 0
    for rel in targets:
        src = TEXT / rel
        if not src.exists():
            print(f"[fiches] missing {src}", file=sys.stderr)
            continue
        dst = FICHES / Path(rel).name
        if dst.exists() and not force:
            print(f"[fiches] skip {rel} (déjà fait, --force pour regen)")
            skipped += 1
            continue
        course = src.read_text()
        print(f"[fiches] summarizing {rel} ...", flush=True)
        try:
            md = run_claude(course, rel)
        except Exception as e:
            print(f"[fiches] FAIL {rel}: {e}", file=sys.stderr)
            continue
        dst.write_text(md)
        ok += 1
        print(f"[fiches] wrote {dst.relative_to(ROOT)}")

    # Normalize titles before building the index so the recap pages stay clean.
    try:
        import subprocess
        subprocess.run([sys.executable, str(ROOT / "scripts" / "normalize_titles.py")], check=False)
    except Exception as e:
        print(f"[fiches] normalize_titles skipped: {e}", file=sys.stderr)

    update_index()
    print(f"[fiches] {ok} nouveaux, {skipped} ignorés (déjà faits), {len(targets) - ok - skipped} échecs")
    return 0 if ok + skipped == len(targets) else 1


if __name__ == "__main__":
    sys.exit(main())

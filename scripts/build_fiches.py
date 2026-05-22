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
    return proc.stdout.strip()


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


def is_verb(card: dict) -> bool:
    if card.get("type") == "verbe" or card.get("pos") == "verbe":
        return True
    front = (card.get("front") or "").strip().lower()
    return front.startswith("å ") or front.startswith("aa ")


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
    vocab = [c for c in cards if not is_verb(c) and c.get("type") in (None, "vocab", "verbe")]
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
    ok = 0
    for rel in targets:
        src = TEXT / rel
        if not src.exists():
            print(f"[fiches] missing {src}", file=sys.stderr)
            continue
        course = src.read_text()
        print(f"[fiches] summarizing {rel} ...", flush=True)
        try:
            md = run_claude(course, rel)
        except Exception as e:
            print(f"[fiches] FAIL {rel}: {e}", file=sys.stderr)
            continue
        dst = FICHES / Path(rel).name
        dst.write_text(md)
        ok += 1
        print(f"[fiches] wrote {dst.relative_to(ROOT)}")

    update_index()
    print(f"[fiches] {ok}/{len(targets)} done")
    return 0 if ok == len(targets) else 1


if __name__ == "__main__":
    sys.exit(main())

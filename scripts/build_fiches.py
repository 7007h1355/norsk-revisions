"""Génère fiches markdown via Claude CLI à partir de cours-text/*.md.

Lit .todo_summarize.txt (ou --all), appelle `claude -p` pour chaque,
écrit fiches/<nom>.md, puis met à jour fiches/index.json.
"""
from __future__ import annotations

import hashlib
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
    """Extract the flashcard JSON array from a fiche.

    Tolerant of:
      - ```json fenced block (canonical)
      - bare ``` fenced block
      - no fence at all (find JSON array after the 'Flashcards' heading)
    Trailing commas before ``]`` are also stripped.
    """
    # 1) Try ```json or ``` fenced block containing an array
    for pat in (
        r"```(?:json)?\s*(\[\s*\{.*?\}\s*\])\s*```",
        r"(?:Flashcards|flashcards).*?(\[\s*\{.*?\}\s*\])",
    ):
        m = re.search(pat, md, re.DOTALL)
        if m:
            raw = m.group(1)
            # tolerate trailing commas
            cleaned = re.sub(r",\s*([\]}])", r"\1", raw)
            try:
                cards = json.loads(cleaned)
                if isinstance(cards, list):
                    return cards
            except json.JSONDecodeError:
                continue
    return []


RECAP_VOCAB = "_recap_vocabulaire"
RECAP_VERBS = "_recap_verbes"


def normalize_fr(s: str) -> str:
    """Aggressive sort key for French headwords.

    - lowercase + accent-fold
    - strip leading articles, partitives, prepositions
    - strip leading parenthesised qualifiers, e.g. "(téléphone) portable" → "portable"
    - strip any remaining non-alpha leading char (commas, dashes, quotes)
    """
    import re
    import unicodedata
    s = s.strip().lower()
    for prefix in (
        "le ", "la ", "les ", "l'",
        "un ", "une ", "des ",
        "du ", "de la ", "de l'", "de ", "d'",
        "à la ", "à l'", "à ", "au ", "aux ",
    ):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    # strip leading parenthesised qualifier only if there's word content AFTER it
    # ("(téléphone) portable" -> "portable", but "(provenance)" alone is kept)
    s = re.sub(r"^\([^)]*\)\s+(?=\S)", "", s)
    # strip trailing gender/short qualifier "(e)", "(s)", "(es)"
    s = re.sub(r"\((?:e|s|es)\)\s*$", "", s).strip()
    # NFD + drop combining marks (accents)
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    # drop all non-alphanumeric chars so "à/sur" sorts as "asur" and joins the 'a' bucket
    # cleanly (spaces would still break ASCII ordering because ' ' < 'b').
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def is_number_entry(card: dict) -> bool:
    """Detect numeric/temporal entries. Catches '0', '8h30', 'un (1)', '3 756'."""
    import re
    back = (card.get("back") or "").strip()
    # Skip entries without any digit (avoids false positives on prepositions like 'de (provenance)')
    if not re.search(r"\d", back):
        return False
    if re.match(r"^\d", back):
        return True
    if re.match(r"^\d", normalize_fr(back) or ""):
        return True
    return False


def number_key(card: dict) -> tuple:
    """Sort by numeric value extracted from the back side.

    '3 756'  -> 3756     (spaces collapsed)
    '8h30'   -> 830      (HhMM concatenated so '8h30' sorts after '8' and before '9h')
    '12:30'  -> 1230
    'un (1)' -> 1
    """
    import re
    back = (card.get("back") or "").strip()
    # HH(h|:)MM form
    m_time = re.match(r"^(\d+)\s*[h:]\s*(\d+)", back)
    if m_time:
        try:
            return (int(m_time.group(1)) * 100 + int(m_time.group(2)), back.lower())
        except ValueError:
            pass
    # Plain leading number, possibly with internal spaces ('3 756')
    m = re.match(r"^([\d ]+)", back) or re.search(r"(\d+)", back)
    if m:
        try:
            return (int(m.group(1).replace(" ", "")), back.lower())
        except ValueError:
            pass
    return (99999, back.lower())


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


def normalize_no(s: str) -> str:
    """Norwegian normalize: lowercase, strip leading 'en/ei/et ' articles, drop trailing parens."""
    import re
    s = (s or "").strip().lower()
    for prefix in ("en ", "ei ", "et "):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    # drop trailing parens qualifier (form variants, plural, etc.)
    s = re.sub(r"\s*\([^)]*\)\s*$", "", s).strip()
    return s


def primary_fr(s: str) -> str:
    """Return the first headword from a French side, stripped of variants and qualifiers.

    'un ami / une amie'   -> 'ami'
    'aller, marcher'      -> 'aller'
    'après (+ nom)'       -> 'apres'   (parenthesised qualifier dropped)
    'animal de compagnie' -> 'animaldecompagnie' (no separator → whole headword)
    """
    import re
    # cut at the first variant separator OR opening parenthesis
    primary = re.split(r"\s*[/,(]\s*", s, 1)[0]
    return normalize_fr(primary)


def dedupe(cards: list[dict]) -> list[dict]:
    """Merge entries pointing to the same Norwegian + primary French headword.

    Key = (norsk word without article/parens, FR primary headword).
    'un ami' + 'un ami / une amie' both map to key=('venn', 'ami') → merged.
    'aimer' vs 'aimer (d'amour)' stay distinct because parens are preserved
    when they come INSIDE the FR text (not at start).
    """
    seen = {}
    for c in cards:
        key = (normalize_no(c.get("front", "")), primary_fr(c.get("back", "")))
        if key not in seen:
            seen[key] = c
        else:
            existing = seen[key]
            srcs = set(filter(None, [existing.get("source", ""), c.get("source", "")]))
            all_srcs = set()
            for s in srcs:
                all_srcs.update(p.strip() for p in s.split(",") if p.strip())
            existing["source"] = ", ".join(sorted(all_srcs))
            # Prefer the entry with shorter/cleaner back (e.g. 'un ami' over 'un ami / une amie')
            if len((c.get("back") or "")) < len((existing.get("back") or "")):
                existing["back"] = c["back"]
            if len((c.get("front") or "")) < len((existing.get("front") or "")):
                existing["front"] = c["front"]
    return list(seen.values())


def merge_by_primary_fr(cards: list[dict]) -> list[dict]:
    """Group cards sharing the same primary FR headword. Concat the Norwegian variants."""
    grouped: dict = {}
    for c in cards:
        key = primary_fr(c.get("back", ""))
        if not key:
            grouped.setdefault(("__nokey__", c.get("back", ""), c.get("front", "")), []).append(c)
            continue
        grouped.setdefault(key, []).append(c)
    out = []
    for key, group in grouped.items():
        if len(group) == 1:
            out.append(group[0])
            continue
        base = dict(group[0])
        # collect unique norwegian variants, preserve original surface form
        seen_norm = set()
        variants = []
        for c in group:
            norm = normalize_no(c.get("front", ""))
            if norm in seen_norm:
                continue
            seen_norm.add(norm)
            variants.append(c.get("front", "").strip())
        base["front"] = " / ".join(variants)
        # prefer the shortest FR back (less cluttered)
        backs = sorted({c.get("back", "").strip() for c in group}, key=len)
        base["back"] = backs[0]
        # merge sources
        all_srcs = set()
        for c in group:
            for p in (c.get("source", "") or "").split(","):
                p = p.strip()
                if p:
                    all_srcs.add(p)
        base["source"] = ", ".join(sorted(all_srcs))
        out.append(base)
    return out


def build_recap_vocab(cards: list[dict]) -> str:
    vocab = [c for c in cards if is_valid_entry(c) and not is_verb(c) and c.get("type") in (None, "vocab", "verbe")]
    vocab = dedupe(vocab)
    vocab = merge_by_primary_fr(vocab)
    numbers = [c for c in vocab if is_number_entry(c)]
    words = [c for c in vocab if not is_number_entry(c)]
    words.sort(key=lambda c: normalize_fr(c.get("back", "")))
    numbers.sort(key=number_key)

    def short_src(src: str) -> str:
        parts = [p.strip() for p in (src or "").split(",") if p.strip()]
        if len(parts) <= 1:
            return src or ""
        # show first source + count of additional ones
        return f"{parts[0]} (+{len(parts) - 1})"

    def render_row(c):
        fr = c.get("back", "").replace("|", "\\|")
        no = c.get("front", "").replace("|", "\\|")
        t = c.get("pos", c.get("type", ""))
        src = short_src(c.get("source", ""))
        return f"| {fr} | {no} | {t} | {src} |"

    lines = [
        "---",
        "title: Récapitulatif — Vocabulaire (A→Z français)",
        "kind: recap",
        f"updated: {__import__('datetime').date.today().isoformat()}",
        "---",
        "",
        "# 📚 Récapitulatif vocabulaire",
        "",
        f"_{len(words)} mots + {len(numbers)} nombres, triés par traduction française. Auto-régénéré à chaque ajout de leçon._",
        "",
        "## Mots",
        "",
        "| Français | Norsk (bokmål) | Type | Source |",
        "|---|---|---|---|",
    ]
    lines.extend(render_row(c) for c in words)
    if numbers:
        lines += [
            "",
            "## Nombres",
            "",
            "| Français | Norsk | Source |",
            "|---|---|---|",
        ]
        for c in numbers:
            fr = c.get("back", "").replace("|", "\\|")
            no = c.get("front", "").replace("|", "\\|")
            src = c.get("source", "")
            lines.append(f"| {fr} | {no} | {src} |")
    return "\n".join(lines) + "\n"


def build_recap_verbs(cards: list[dict]) -> str:
    verbs = [c for c in cards if is_verb(c)]
    verbs = dedupe(verbs)
    verbs = merge_by_primary_fr(verbs)
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
    def short_src(src: str) -> str:
        parts = [p.strip() for p in (src or "").split(",") if p.strip()]
        if len(parts) <= 1:
            return src or ""
        return f"{parts[0]} (+{len(parts) - 1})"

    for c in verbs:
        fr = c.get("back", "").replace("|", "\\|")
        no = c.get("front", "").replace("|", "\\|")
        src = short_src(c.get("source", ""))
        lines.append(f"| {fr} | {no} | {src} |")
    return "\n".join(lines) + "\n"


def _sort_key(fp: Path) -> tuple:
    """Sort fiches chronologically. Extract DD.MM from filename, else fallback alpha."""
    m = re.search(r"(\d{2})\.(\d{2})", fp.stem)
    if m:
        dd, mm = int(m.group(1)), int(m.group(2))
        # Norwegian school year: April-May months. Use (mm, dd) so April < May.
        return (0, mm, dd, fp.stem.lower())
    # Fasit/Samliv/Hei before dated lessons
    return (-1, 0, 0, fp.stem.lower())


def update_index() -> None:
    """Aggregate all fiches into fiches/index.json (for PWA), regen recaps."""
    entries = []
    all_cards = []
    fiche_files = sorted(
        (fp for fp in FICHES.glob("*.md") if not fp.stem.startswith("_recap_")),
        key=_sort_key,
    )
    for fp in fiche_files:
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
        if not cards:
            print(f"[fiches] WARN: {fp.name} has 0 flashcards (parsing failed?)", file=sys.stderr)
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

    # Dedupe the flat flashcard pool so the Flashcards page doesn't show the same
    # `å være = être` six times across lessons, nor distinct `bien=bra` + `bien=godt`
    # entries that look duplicated to a learner — those collapse to `bien=bra / godt`.
    flashcards = merge_by_primary_fr(dedupe([c for c in all_cards if is_valid_entry(c)]))

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
    (FICHES / "flashcards.json").write_text(json.dumps(flashcards, ensure_ascii=False, indent=2))
    print(f"[fiches] index: {len(entries)} fiches, {len(all_cards)} → {len(flashcards)} cartes uniques (recap vocab={n_vocab}, verbes={n_verbs})")


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
    prompt_hash = hashlib.sha1(PROMPT.encode("utf-8")).hexdigest()[:10]
    ok = 0
    skipped = 0
    for rel in targets:
        src = TEXT / rel
        if not src.exists():
            print(f"[fiches] missing {src}", file=sys.stderr)
            continue
        course = src.read_text()
        # Skip only if the destination already exists AND was built from the same source
        # text AND the same prompt. Editing prompt_fiche.md or the upstream cours-text/
        # therefore invalidates the cache automatically.
        src_hash = hashlib.sha1(course.encode("utf-8")).hexdigest()[:10]
        dst = FICHES / Path(rel).name
        if dst.exists() and not force:
            head = dst.read_text(errors="replace")[:600]
            cached_src = re.search(r"^source_hash:\s*(\S+)", head, re.MULTILINE)
            cached_prompt = re.search(r"^prompt_hash:\s*(\S+)", head, re.MULTILINE)
            if (cached_src and cached_src.group(1) == src_hash
                    and cached_prompt and cached_prompt.group(1) == prompt_hash):
                print(f"[fiches] skip {rel} (source+prompt inchangés)")
                skipped += 1
                continue
        print(f"[fiches] summarizing {rel} ...", flush=True)
        try:
            md = run_claude(course, rel)
        except Exception as e:
            print(f"[fiches] FAIL {rel}: {e}", file=sys.stderr)
            continue
        # Inject `source` (raw filename stem) and cache hashes into the frontmatter.
        # Claude no longer puts `source` in its output; we manage it here so that
        # normalize_titles.py and update_index can still rely on it.
        source_value = Path(rel).stem
        if md.startswith("---"):
            end = md.find("\n---", 3)
            if end > 0:
                inject = f"\nsource: {source_value}\nsource_hash: {src_hash}\nprompt_hash: {prompt_hash}"
                md = md[:end] + inject + md[end:]
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

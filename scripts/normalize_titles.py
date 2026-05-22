"""Normalise les titres des fiches en français cohérent :

- Norskkurs DD.MM → "Cours du DD/MM — <thème>"
- Samtaletime DD.MM → "Conversation DD/MM — <thème>"
- Fasit oppgaver kap N → "Corrigés — Chapitre N"
- Sources avec titre 100% norvégien → ajoute traduction FR

Lit chaque fiche, regénère le frontmatter `title`, préserve le reste.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FICHES = ROOT / "fiches"

# Traductions FR pour titres entièrement norvégiens
NORSK_TITLE_FR = {
    "hei og velkommen": "Bienvenue (Hei og velkommen)",
    "samliv og familie i norge": "Famille et vie commune en Norvège",
    "klokka og daglige rutiner": "L'heure et routines quotidiennes",
    "kapittel 3 - en god venn (på fest)": "Chapitre 3 — En god venn (à la fête)",
    "fra morgen til kveld (la journée de monica)": "Du matin au soir — la journée de Monica",
}

DATE_RE = re.compile(r"(\d{2})\.(\d{2})")
NORSKKURS_PREFIX = re.compile(
    r"^(?:norskkurs|samtaletime|cours|conversation)(?:\s+du)?\s+\d{2}[./]\d{2}\s*[—\-:]\s*",
    re.IGNORECASE,
)
CHAPITRE_PREFIX = re.compile(r"^chapitre\s+\d+\s*[—\-:]\s*", re.IGNORECASE)
CORRIGES_PREFIX = re.compile(r"^corrig[ée]s?\s*[—\-:]\s*chapitre\s+\d+\s*\(?", re.IGNORECASE)


def parse_frontmatter(text: str) -> tuple[dict, str, str]:
    if not text.startswith("---"):
        return {}, "", text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, "", text
    fm_block = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    fm = {}
    for line in fm_block.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm, fm_block, body


def serialize_fm(fm: dict, order_first: list[str] = ("title", "source", "themes", "niveau", "kind", "updated")) -> str:
    keys = [k for k in order_first if k in fm] + [k for k in fm if k not in order_first]
    return "\n".join(f"{k}: {fm[k]}" for k in keys)


def normalize_subject(raw_title: str) -> str:
    """Strip recognized prefixes repeatedly until stable, then translate or capitalize."""
    s = raw_title.strip()
    for _ in range(5):  # iterate until stable, max 5 passes
        before = s
        s = NORSKKURS_PREFIX.sub("", s)
        s = CORRIGES_PREFIX.sub("", s)
        s = s.strip(" -—:")
        # also strip trailing ")" if we removed an opening one
        if s == before:
            break
    low = s.lower()
    if low in NORSK_TITLE_FR:
        return NORSK_TITLE_FR[low]
    return s[:1].upper() + s[1:] if s else s


def new_title(source: str, current_title: str) -> str:
    src_low = source.lower()
    src_no_ext = source.rsplit(".", 1)[0]

    # Norskkurs DD.MM
    m = re.match(r"norskkurs\s+(\d{2})\.(\d{2})", src_low)
    if m:
        dd, mm = m.group(1), m.group(2)
        subject = normalize_subject(current_title)
        if not subject:
            return f"Cours du {dd}/{mm}"
        return f"Cours du {dd}/{mm} — {subject}"

    # Samtaletime DD.MM
    m = re.match(r"samtaletime\s+(\d{2})\.(\d{2})", src_low)
    if m:
        dd, mm = m.group(1), m.group(2)
        subject = normalize_subject(current_title)
        return f"Conversation du {dd}/{mm} — {subject}" if subject else f"Conversation du {dd}/{mm}"

    # Fasit oppgaver kap N
    m = re.match(r"fasit\s+oppgaver\s+kap\.?\s*(\d+)", src_low)
    if m:
        n = m.group(1)
        subject = normalize_subject(current_title)
        # strip leading "Chapitre N —" and "Corrigés — Chapitre N (" prefixes
        subject = CHAPITRE_PREFIX.sub("", subject)
        subject = CORRIGES_PREFIX.sub("", subject)
        subject = subject.strip(" -—:()")
        return f"Corrigés — Chapitre {n} ({subject})" if subject else f"Corrigés — Chapitre {n}"

    # All-Norwegian title → translate via table
    low = current_title.lower().strip()
    if low in NORSK_TITLE_FR:
        return NORSK_TITLE_FR[low]

    # Fallback: keep as-is but apply normalize_subject (strip prefix)
    return normalize_subject(current_title) or current_title


def balance_parens(s: str) -> str:
    """Append missing closing parens; strip unmatched closing ones."""
    open_count = 0
    out = []
    for ch in s:
        if ch == "(":
            open_count += 1
            out.append(ch)
        elif ch == ")":
            if open_count > 0:
                open_count -= 1
                out.append(ch)
            # else: drop the orphan ")"
        else:
            out.append(ch)
    out.append(")" * open_count)
    return "".join(out)


def process(fp: Path) -> bool:
    text = fp.read_text()
    fm, _, body = parse_frontmatter(text)
    if not fm:
        return False
    if fm.get("kind") == "recap":
        return False
    old = fm.get("title", "")
    src = fm.get("source", "") or fp.stem
    nt = balance_parens(new_title(src, old))
    if nt == old:
        return False
    fm["title"] = nt
    new_text = "---\n" + serialize_fm(fm) + "\n---\n\n" + body.lstrip()
    fp.write_text(new_text)
    print(f"  {old}\n→ {nt}\n")
    return True


def main() -> int:
    changed = 0
    for fp in sorted(FICHES.glob("*.md")):
        if process(fp):
            changed += 1
    print(f"[titles] {changed} titres normalisés")
    return 0


if __name__ == "__main__":
    sys.exit(main())

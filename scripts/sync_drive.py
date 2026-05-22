"""Sync Google Drive shared folder → cours-raw/, detect changes via hash.

Strategy:
1. Download fresh snapshot into a staging dir (atomic; partial downloads can't corrupt state).
2. Diff the *staging* tree against persisted `state` → adds/modifications/removals.
3. Promote staging → cours-raw/ and delete anything the snapshot no longer contains.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

import gdown

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "cours-raw"
STATE = ROOT / "scripts" / ".sync_state.json"
DRIVE_URL_FILE = ROOT / "scripts" / "drive_url.txt"

EXTS = {".pdf", ".docx", ".pptx", ".ppsx", ".doc", ".ppt", ".txt"}


def file_hash(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2, sort_keys=True))


def download(url: str, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    print(f"[sync] gdown --folder {url} -> {target}", flush=True)
    gdown.download_folder(url=url, output=str(target), quiet=False, use_cookies=False)


def collect_files(root: Path) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in EXTS]


def diff(
    state: dict, files: list[Path], base: Path
) -> tuple[list[str], list[str], list[str], dict]:
    """Compute (added_rels, modified_rels, removed_rels, new_state) relative to `base`."""
    new_state: dict = {}
    added: list[str] = []
    modified: list[str] = []
    for p in files:
        rel = str(p.relative_to(base))
        h = file_hash(p)
        new_state[rel] = h
        prev = state.get(rel)
        if prev is None:
            added.append(rel)
        elif prev != h:
            modified.append(rel)
    removed = [k for k in state if k not in new_state]
    return added, modified, removed, new_state


def main() -> int:
    if not DRIVE_URL_FILE.exists():
        print(f"[sync] missing {DRIVE_URL_FILE} (put folder URL on first line)", file=sys.stderr)
        return 2
    url = DRIVE_URL_FILE.read_text().strip().splitlines()[0]

    # Atomic snapshot in a sibling dir (outside RAW so collect_files can't see it).
    staging = ROOT / ".sync_staging"
    if staging.exists():
        shutil.rmtree(staging)
    try:
        download(url, staging)
    except Exception as e:
        print(f"[sync] download failed: {e}", file=sys.stderr)
        shutil.rmtree(staging, ignore_errors=True)
        return 1

    # Diff against the fresh snapshot — lets us detect files deleted on Drive.
    state = load_state()
    staged_files = [p for p in collect_files(staging) if "_mock" not in p.parts]
    added, modified, removed, new_state = diff(state, staged_files, staging)

    # Promote staging → RAW.
    RAW.mkdir(parents=True, exist_ok=True)
    for src in staged_files:
        rel = src.relative_to(staging)
        dst = RAW / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    # Remove anything in RAW that the snapshot no longer contains (preserve _mock).
    for p in collect_files(RAW):
        if "_mock" in p.parts:
            continue
        rel = str(p.relative_to(RAW))
        if rel not in new_state:
            p.unlink()

    shutil.rmtree(staging, ignore_errors=True)
    save_state(new_state)

    print(f"[sync] added={len(added)} modified={len(modified)} removed={len(removed)}")
    for r in added:
        print(f"  + {r}")
    for r in modified:
        print(f"  ~ {r}")
    for r in removed:
        print(f"  - {r}")

    # Emit list of files needing reprocessing (rel paths under cours-raw/).
    todo = ROOT / "scripts" / ".todo_extract.txt"
    todo.write_text("\n".join(added + modified))
    return 0


if __name__ == "__main__":
    sys.exit(main())

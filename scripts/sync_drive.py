"""Sync Google Drive shared folder → cours-raw/, detect changes via hash."""
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
    exts = {".pdf", ".docx", ".pptx", ".ppsx", ".doc", ".ppt", ".txt"}
    return [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in exts]


def diff(state: dict, files: list[Path]) -> tuple[list[Path], list[Path], list[str]]:
    new_state = {}
    added, modified = [], []
    for p in files:
        rel = str(p.relative_to(RAW))
        h = file_hash(p)
        new_state[rel] = h
        prev = state.get(rel)
        if prev is None:
            added.append(p)
        elif prev != h:
            modified.append(p)
    removed = [k for k in state if k not in new_state]
    return added, modified, removed, new_state  # type: ignore[return-value]


def main() -> int:
    if not DRIVE_URL_FILE.exists():
        print(f"[sync] missing {DRIVE_URL_FILE} (put folder URL on first line)", file=sys.stderr)
        return 2
    url = DRIVE_URL_FILE.read_text().strip().splitlines()[0]

    # Work in a staging dir so partial downloads don't corrupt state.
    staging = RAW / "_staging"
    if staging.exists():
        shutil.rmtree(staging)
    try:
        download(url, staging)
    except Exception as e:
        print(f"[sync] download failed: {e}", file=sys.stderr)
        return 1

    # Promote staging into RAW root (preserving relative tree).
    for src in staging.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(staging)
        dst = RAW / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    shutil.rmtree(staging)

    state = load_state()
    files = [p for p in collect_files(RAW) if "_mock" not in p.parts and "_staging" not in p.parts]
    added, modified, removed, new_state = diff(state, files)
    save_state(new_state)

    print(f"[sync] added={len(added)} modified={len(modified)} removed={len(removed)}")
    for p in added:
        print(f"  + {p.relative_to(RAW)}")
    for p in modified:
        print(f"  ~ {p.relative_to(RAW)}")
    for r in removed:
        print(f"  - {r}")

    # Emit list of files needing reprocessing (for downstream extract step).
    todo = ROOT / "scripts" / ".todo_extract.txt"
    todo.write_text("\n".join(str(p.relative_to(RAW)) for p in added + modified))
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Build dist/Install Fly Genetics.md: a single-file installer that embeds the
Genotype, Cross Genotypes and Tidy scripts plus the Computer Modern font.

Usage (from the repo root):  uv run installer/build.py [output path]
(default dist/Install Fly Genetics.md; tests build to a temporary path)
"""

import base64
import datetime
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = [
    "Genotype",
    "Cross Genotypes",
    "Cross Mode",
    "Tidy",
    "Tidy Below",
    "Select Lineage",
    "Select Below",
    "Break Cross",
    "Update Fly Genetics",
]
FONT = ROOT / "fonts" / "cmu-serif-500-roman.ttf"
LICENSE = ROOT / "fonts" / "CMU-OFL.txt"
TEMPLATE = ROOT / "installer" / "installer.template.md"
OUT = ROOT / "dist" / "Install Fly Genetics.md"
PLACEHOLDER = "/*__PAYLOAD__*/null"


def version() -> str:
    """Short commit hash, marked dirty if the working tree has changes."""
    sha = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain", "--", "scripts"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return f"{sha}{'-dirty' if dirty else ''} ({datetime.datetime.now(tz=datetime.UTC).date().isoformat()})"


def main() -> None:
    font = FONT.read_bytes()
    payload = {
        "version": version(),
        "scripts": {
            name: (ROOT / "scripts" / f"{name}.md").read_text() for name in SCRIPTS
        },
        "font": {
            "name": FONT.name,
            "size": len(font),
            "base64": base64.b64encode(font).decode(),
        },
        "license": {"name": LICENSE.name, "text": LICENSE.read_text()},
    }
    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else OUT
    template = TEMPLATE.read_text()
    if template.count(PLACEHOLDER) != 1:
        raise SystemExit(f"{TEMPLATE} must contain {PLACEHOLDER} exactly once")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        template.replace(PLACEHOLDER, json.dumps(payload, ensure_ascii=False))
    )
    print(
        f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB), version {payload['version']}"
    )


if __name__ == "__main__":
    main()

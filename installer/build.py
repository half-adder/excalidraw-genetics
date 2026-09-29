"""Build dist/Install Fly Genetics.md: a single-file installer that embeds the
Genotype, Cross Genotypes and Tidy scripts plus the Computer Modern font.

Usage (from the repo root):  uv run installer/build.py [output path]
(default dist/Install Fly Genetics.md; tests build to a temporary path)
"""

import base64
import hashlib
import json
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
    """Release version from VERSION (a date, e.g. 2026.9.29 or 2026.9.29.2)."""
    return (ROOT / "VERSION").read_text().strip()


def changelog() -> list[dict[str, str]]:
    """CHANGELOG.md sections, newest first, as [{version, text}]."""
    entries: list[dict[str, str]] = []
    for block in (ROOT / "CHANGELOG.md").read_text().split("\n## ")[1:]:
        head, _, body = block.partition("\n")
        entries.append({"version": head.strip(), "text": body.strip()})
    return entries


def fingerprint(scripts: dict[str, str], font: bytes, license_text: str) -> str:
    """Short SHA-256 over everything the installer writes; the updater compares
    this, so a release is detected even if VERSION was not bumped."""
    h = hashlib.sha256()
    for name in sorted(scripts):
        h.update(name.encode() + b"\0" + scripts[name].encode() + b"\0")
    h.update(font + b"\0" + license_text.encode())
    return h.hexdigest()[:12]


def main() -> None:
    font = FONT.read_bytes()
    scripts = {name: (ROOT / "scripts" / f"{name}.md").read_text() for name in SCRIPTS}
    license_text = LICENSE.read_text()
    payload = {
        "version": version(),
        "fingerprint": fingerprint(scripts, font, license_text),
        "changelog": changelog(),
        "scripts": scripts,
        "font": {
            "name": FONT.name,
            "size": len(font),
            "base64": base64.b64encode(font).decode(),
        },
        "license": {"name": LICENSE.name, "text": license_text},
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
        f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB), version {payload['version']} ({payload['fingerprint']})"
    )


if __name__ == "__main__":
    main()

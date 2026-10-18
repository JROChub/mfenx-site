#!/usr/bin/env python3
"""Write the site's text-and-data-mining declarations into every published page.

Adds, idempotently, to each HTML head under public/:
  <meta name="tdm-reservation" content="1">
  <meta name="tdm-policy" content="https://mfenx.com/tweek/policy/no-ai/">
  <meta name="robots" content="… noai, noimageai">   (merged into an existing robots meta if present)

Also validates that public/robots.txt and public/.well-known/tdmrep.json are present.
Run after adding a page. `--check` reports pages that would change and exits 1 instead of writing.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "public"
POLICY = "https://mfenx.com/tweek/policy/no-ai/"
RESERVATION = "1"
ROBOTS_DIRECTIVES = ("noai", "noimageai")

CHARSET = re.compile(r"<meta\s+charset=[^>]*>", re.IGNORECASE)
HEAD_OPEN = re.compile(r"<head[^>]*>", re.IGNORECASE)
META = re.compile(r"<meta\s+name=\"(?P<name>[^\"]+)\"\s+content=\"(?P<content>[^\"]*)\"\s*/?>", re.IGNORECASE)


def closing_style(text: str) -> str:
    m = CHARSET.search(text)
    return " />" if m and m.group(0).rstrip().endswith("/>") else ">"


def indent_of(text: str, index: int) -> str:
    line_start = text.rfind("\n", 0, index) + 1
    return re.match(r"[ \t]*", text[line_start:index]).group(0)


def apply(text: str) -> str:
    close = closing_style(text)
    metas = {m.group("name").lower(): m for m in META.finditer(text)}
    # robots: merge directives into an existing tag, or add a new one
    robots = metas.get("robots")
    if robots:
        current = [d.strip() for d in robots.group("content").split(",") if d.strip()]
        for d in ROBOTS_DIRECTIVES:
            if d not in current:
                current.append(d)
        new = f'<meta name="robots" content="{", ".join(current)}"{close}'
        text = text[: robots.start()] + new + text[robots.end():]
        metas = {m.group("name").lower(): m for m in META.finditer(text)}
    additions = []
    if "tdm-reservation" not in metas:
        additions.append(f'<meta name="tdm-reservation" content="{RESERVATION}"{close}')
    if "tdm-policy" not in metas:
        additions.append(f'<meta name="tdm-policy" content="{POLICY}"{close}')
    if "robots" not in metas:
        additions.append(f'<meta name="robots" content="{", ".join(ROBOTS_DIRECTIVES)}"{close}')
    if not additions:
        return text
    anchor = CHARSET.search(text) or HEAD_OPEN.search(text)
    if not anchor:
        raise ValueError("no <head> or charset meta found")
    indent = indent_of(text, anchor.start())
    block = "".join(f"\n{indent}{tag}" for tag in additions)
    return text[: anchor.end()] + block + text[anchor.end():]


def check_files(root: Path) -> list[str]:
    problems = []
    robots = root / "robots.txt"
    if not robots.is_file():
        problems.append("missing public/robots.txt")
    elif "User-agent:" not in robots.read_text(encoding="utf-8"):
        problems.append("public/robots.txt has no User-agent rules")
    tdm = root / ".well-known" / "tdmrep.json"
    if not tdm.is_file():
        problems.append("missing public/.well-known/tdmrep.json")
    else:
        try:
            data = json.loads(tdm.read_text(encoding="utf-8"))
            assert isinstance(data, list) and data and all(
                "location" in e and "tdm-reservation" in e for e in data
            ), "entries need location and tdm-reservation"
        except (json.JSONDecodeError, AssertionError) as exc:
            problems.append(f"public/.well-known/tdmrep.json invalid: {exc}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true", help="report pages missing declarations; write nothing")
    args = parser.parse_args()
    root = args.root.resolve()
    problems = check_files(root)
    changed = []
    for path in sorted(root.rglob("*.html")):
        original = path.read_text(encoding="utf-8")
        updated = apply(original)
        if updated != original:
            changed.append(path.relative_to(root).as_posix())
            if not args.check:
                path.write_text(updated, encoding="utf-8")
    if args.check:
        for page in changed:
            problems.append(f"page lacks TDM declarations: {page}")
        for problem in problems:
            print(problem, file=sys.stderr)
        print(f"checked {sum(1 for _ in root.rglob('*.html'))} pages; {len(changed)} missing declarations")
        return 1 if problems else 0
    for problem in problems:
        print(problem, file=sys.stderr)
    print(f"updated {len(changed)} pages" + (": " + ", ".join(changed) if changed else ""))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())

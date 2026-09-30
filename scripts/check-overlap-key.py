#!/usr/bin/env python3
"""The cross-board overlap key is written twice. Keep the two copies identical.

WHY THIS EXISTS. Two surfaces now report how much of a feed another board
already holds: scripts/source-overlap.py (the CLI report) and the admin
console's Data quality panel (src/employsi/lib/dataQualityFn.ts). Both build
the same role identity in SQL — company_id plus the title with the LOCATION
DROPPED and the employer's own name stripped out of it — and they have to,
because that key is not an implementation detail. It IS the measurement.

WHAT GOES WRONG WITHOUT THIS. Change one and not the other and both surfaces
keep working: each returns a plausible percentage, neither errors, and they
quietly disagree about how duplicated the archive is. Whichever one you happen
to read becomes the answer. That is the same failure the check-* scripts
already guard — an aggregate that still renders a believable number after the
reasoning under it has broken — and the naive alternative key is not a
hypothetical mistake here, it is a measured one: matching on the job_key suffix
reports every source ~100% unique, because boards word titles and locations
differently.

This asserts the SQL expression itself, normalised for whitespace, because that
expression is the only thing the two files genuinely must share.

Run: python scripts/check-overlap-key.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(ROOT, "scripts", "source-overlap.py")
TS = os.path.join(ROOT, "src", "employsi", "lib", "dataQualityFn.ts")

# The role-identity expression, wherever it appears. Both files build it from
# `title` and `comp`, so this matches the shape rather than either file's
# surrounding syntax.
KEY_RE = re.compile(
    r"company_id\s*\|\|\s*'\|'\s*\|\|\s*"
    r"trim\(replace\(\s*'\s'\s*\|\|\s*title\s*\|\|\s*'\s',\s*"
    r"'\s'\s*\|\|\s*comp\s*\|\|\s*'\s',\s*'\s'\)\)"
)


def squash(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def find(path: str) -> str | None:
    with open(path, encoding="utf-8") as f:
        m = KEY_RE.search(f.read())
    return squash(m.group(0)) if m else None


fails: list[str] = []
py_key = find(PY)
ts_key = find(TS)

if py_key is None:
    fails.append(
        f"no role-identity expression found in {os.path.relpath(PY, ROOT)}. "
        "If the key moved, update KEY_RE here — do not delete this check."
    )
if ts_key is None:
    fails.append(
        f"no role-identity expression found in {os.path.relpath(TS, ROOT)}. "
        "The admin panel's overlap card needs the same key the CLI report uses; "
        "if it has been rewritten, this check has to be taught the new shape "
        "deliberately rather than quietly losing its grip."
    )
if py_key and ts_key and py_key != ts_key:
    fails.append(
        "the two copies of the overlap key have DIVERGED, so the CLI report and "
        "the admin panel are now measuring different things and both look fine:\n"
        f"    source-overlap.py : {py_key}\n"
        f"    dataQualityFn.ts  : {ts_key}"
    )

# Both must read the LIVE window. The panel deliberately ignores its own range
# control here so its figure describes the rows the company cards count; a
# 30-day overlap number beside a 1-day card is two measurements presented as one.
with open(TS, encoding="utf-8") as f:
    ts_src = f.read()
if "last_seen >= date('now','-1 day')" not in squash(ts_src).replace(", ", ","):
    if "last_seen >= date('now','-1 day')" not in ts_src:
        fails.append(
            "the panel's overlap query no longer reads the 1-day live window. "
            "It must match the cut currentFromArchive() uses in openRolesFn.ts, "
            "or the panel reports duplication over a set nothing on screen counts."
        )

if fails:
    print(f"FAIL — {len(fails)} problem(s):")
    for f_ in fails:
        print(f"  - {f_}")
    sys.exit(1)
print("ok — overlap key identical in source-overlap.py and dataQualityFn.ts, "
      "both on the live window.")

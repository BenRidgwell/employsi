#!/usr/bin/env python3
"""
The company roster, shared by every scraper driver.

Reads it out of the TypeScript by RUNNING the modules (scripts/roster.ts via
bun) rather than regexing the source. That distinction matters: the listed
roster declares object literals a regex can see, but the Top-150 private roster
is built with `RAW.map(buildPrivate)`, so its ids and names only exist once the
module has run. Drivers that regexed the source walked 205 companies and
silently skipped 150.

Which is why there is NO regex fallback here. A fallback would reintroduce the
exact failure this replaces — a short roster that looks like a successful run.
If bun is missing or the dump fails, this raises, and the caller stops.
"""
from __future__ import annotations
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


class RosterError(RuntimeError):
    pass


def load_roster(only: set[str] | None = None, limit: int | None = None,
                with_cities: bool = False) -> list[dict]:
    """Every company the scrapers walk: {id, name, sector, group, cities}.

    `only` filters to a set of ids; `limit` truncates (both after the full list
    is loaded, so a --limit run is a prefix of the real roster rather than a
    different roster).

    `with_cities` adds the exchange-listed companies plotted on each global hub
    (cityRosters.ts) — about 640 more names, including the Mumbai and Bengaluru
    ones. It is OFF by default so the Australian drivers keep walking exactly
    the 355 companies they always have; only scrapers that cover those markets
    ask for them.
    """
    try:
        p = subprocess.run(
            ["bun", "run", os.path.join(HERE, "roster.ts")]
            + (["--with-cities"] if with_cities else []),
            capture_output=True,
            timeout=120,
            cwd=ROOT,
        )
    except FileNotFoundError as e:
        raise RosterError(
            "bun is required to read the company roster "
            "(the private roster is generated, so it cannot be read from source). "
            "Install bun: https://bun.sh"
        ) from e
    if p.returncode != 0:
        raise RosterError(f"roster dump failed: {p.stderr.decode()[:300]}")
    try:
        rows = json.loads(p.stdout.decode())
    except Exception as e:
        raise RosterError(f"roster dump was not JSON: {p.stdout[:200]!r}") from e
    if not isinstance(rows, list) or not rows:
        raise RosterError("roster dump was empty")
    if only:
        rows = [r for r in rows if r.get("id") in only]
    if limit is not None:
        rows = rows[:limit]
    return rows


if __name__ == "__main__":
    r = load_roster()
    print(f"{len(r)} companies")
    for x in r[:3]:
        print(" ", x["id"], "|", x["name"], "|", x.get("sector"))

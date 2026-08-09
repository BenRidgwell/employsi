#!/usr/bin/env python3
"""Unpack a design-system "bundled page" export into a plain static page.

The design tool exports a single self-extracting HTML file: a base64+gzip
manifest of every asset, a JSON template, and a ~30KB runtime that unpacks the
manifest into blob URLs on DOMContentLoaded. That format exists so one file can
be emailed around. It is the wrong thing to serve:

  * the whole 1.5MB payload is one uncacheable HTML document, re-downloaded in
    full whenever any part of the design changes;
  * nothing renders until the unpacker has base64-decoded and gunzipped ~1.9MB
    on the main thread, so the visitor sees a placeholder thumbnail and an
    "Unpacking…" badge first;
  * the runtime mints blob: URLs and runs a postMessage relay between frames,
    neither of which a static marketing graphic has any use for.

So this writes the template out as ordinary HTML with the assets beside it as
ordinary files, which the CDN can cache individually and the browser can render
without executing an unpacker.

    python3 scripts/unpack-design-bundle.py <bundle.html> <name>

writes public/<name>.html and public/<name>/*.

TWO THINGS THE RUNTIME DID THAT THIS HAS TO DO INSTEAD
Both are hooks the design runtime already supports, so neither is a patch to
vendored code:

  1. `window.__resources` maps an original CDN URL to a replacement. dc-runtime
     reads it through cdnScriptFor() before falling back to unpkg, and the
     globe component reads `__resources.worldAtlas` before falling back to
     jsDelivr. Setting it is what keeps the page off the network — without it
     the page still works, but silently fetches React, ReactDOM and a 108KB
     world atlas from public CDNs on every visit.
  2. dc-runtime's boot() re-fetches location.href to re-read the template when
     `window.__resources` is absent. Defining it also removes that second fetch
     of the whole document.

SIZING: the design scales itself to whatever width it is given (see the fit()
handler in the template — it reads clientWidth and applies a transform), so its
height is a FUNCTION of its width and cannot be pinned by one aspect-ratio in
the embedding page. A height-reporting shim is injected so the parent can size
the iframe exactly; see the comment on REPORT_JS.
"""

import base64
import gzip
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

EXT = {
    "image/svg+xml": "svg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "application/json": "json",
    "text/javascript": "js",
    "application/javascript": "js",
    "text/css": "css",
    "font/woff2": "woff2",
    "font/woff": "woff",
}

# Recognised payloads get a real filename. Matching is on content, not on the
# uuid, because the uuids are regenerated on every export — a name table keyed
# by uuid would silently fall back to uuid filenames on the next bundle.
SIGNATURES = [
    ("react-dom", lambda t: "react-dom.production.min.js" in t[:400]),
    ("react", lambda t: "react.production.min.js" in t[:400]),
    ("d3", lambda t: t.startswith("// https://d3js.org")),
    ("topojson-client", lambda t: "topojson-client" in t[:200]),
    ("lucide", lambda t: "@license lucide" in t[:200]),
    ("skills-globe", lambda t: t.lstrip().startswith("// <skills-globe>")),
    ("dc-runtime", lambda t: "GENERATED from dc-runtime" in t[:200]),
    ("ds-bundle", lambda t: t.lstrip().startswith("/* @ds-bundle:")),
    ("world-atlas", lambda t: '"type":"Topology"' in t[:200]),
]

# The CDN URLs dc-runtime would otherwise reach for. Kept verbatim: they are
# lookup KEYS into __resources, matched by exact string, not URLs we fetch.
REACT_URL = "https://unpkg.com/react@18.3.1/umd/react.production.min.js"
REACT_DOM_URL = "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"

# dc-runtime injects its own base stylesheet at init:
#
#     html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}
#
# which is right for a page that owns the viewport and wrong for one being
# measured: it holds the document at exactly the frame's height no matter how
# small the artboard scaled, so the height reported below would be whatever the
# parent already guessed and could never correct it downward. Verified in a
# real browser — the export reported 1000px at every width until this was
# added. The runtime's rule carries no !important, so this wins on that alone,
# but the selectors are also more specific so it survives a reordering.
UNPIN_CSS = """
<style>
  html:root, :root body { height: auto !important; min-height: 0 !important; }
  :root #dc-root, :root #dc-root > .sc-host { height: auto !important; }
</style>
"""

REPORT_JS = """
<script>
/* Report our rendered height to the embedding page.
 *
 * The design fits itself to the width it is handed and its height follows from
 * that, so the parent cannot express this as a fixed aspect-ratio without
 * either clipping the graphic or leaving a band of dead space under it. The
 * parent listens for this message and sets the iframe height to match; it
 * falls back to an approximate ratio if this never arrives.
 *
 * Same-origin (both are served by the app Worker), so the message is addressed
 * to this exact origin rather than '*'. */
(function () {
  var last = 0;
  function report(force) {
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (!h || (h === last && !force)) return;
    last = h;
    try { parent.postMessage({ employsiPreviewHeight: h }, location.origin); } catch (e) {}
  }
  /* Answer a ping unconditionally, ignoring the de-dupe above.
   *
   * Without this the embed is a race the parent loses more often than not:
   * this page finishes booting and posts its one height before the parent
   * route has hydrated and attached its listener, and every later post is
   * suppressed because the height has not CHANGED since. Measured in a real
   * browser — the parent received nothing and silently kept its fallback
   * ratio, which is a 1px clip at phone widths and would be a much worse one
   * the moment the artboard's proportions change. So the parent asks, and an
   * answer is always sent. */
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    if (e.data && e.data.employsiPreviewPing) report(true);
  });
  window.addEventListener('resize', report);
  window.addEventListener('load', report);
  document.addEventListener('DOMContentLoaded', report);
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);
  /* The runtime swaps <x-dc> for the rendered tree only after React has
   * loaded, and web fonts settle later still. ResizeObserver catches both, but
   * these bounded retries cover a browser without one. */
  [0, 60, 200, 600, 1500, 3000].forEach(function (d) { setTimeout(report, d); });
})();
</script>
"""


def unpack(bundle: pathlib.Path, name: str) -> None:
    src = bundle.read_text(encoding="utf8", errors="replace")

    def island(kind: str) -> str | None:
        m = re.search(r'<script type="__bundler/%s"[^>]*>(.*?)</script>' % kind, src, re.S)
        return m.group(1) if m else None

    manifest_raw, template_raw = island("manifest"), island("template")
    if not manifest_raw or not template_raw:
        sys.exit("Not a bundled page: missing manifest/template islands.")
    manifest = json.loads(manifest_raw)
    template = json.loads(template_raw)

    outdir = ROOT / "public" / name
    outdir.mkdir(parents=True, exist_ok=True)
    for stale in outdir.iterdir():
        if stale.is_file():
            stale.unlink()

    used: set[str] = set()
    written: dict[str, str] = {}
    for uuid, entry in manifest.items():
        raw = base64.b64decode(entry["data"])
        if entry.get("compressed"):
            raw = gzip.decompress(raw)
        ext = EXT.get(entry["mime"])
        if not ext:
            sys.exit(f"Unknown mime {entry['mime']} for {uuid} — add it to EXT.")
        stem = None
        if ext in ("js", "json", "svg"):
            text = raw.decode("utf8", "replace")
            for candidate, test in SIGNATURES:
                if test(text):
                    stem = candidate
                    break
        if stem is None:
            # Fall back to the alt text / font-family the template gives it, so
            # the directory stays readable even for assets with no signature.
            m = re.search(r'<img src="%s" alt="([^"]{1,40})"' % re.escape(uuid), template)
            if m:
                stem = re.sub(r"[^a-z0-9]+", "-", m.group(1).lower()).strip("-")
            else:
                m = re.search(
                    r"font-family:\s*'([^']+)';[^}]*?font-weight:\s*([^;]+);\s*src:\s*url\(\"%s\"\)"
                    % re.escape(uuid),
                    template,
                    re.S,
                )
                if m:
                    fam = re.sub(r"[^a-z0-9]+", "-", m.group(1).lower()).strip("-")
                    stem = f"{fam}-{re.sub(r'[^0-9]+', '-', m.group(2)).strip('-')}"
        if stem is None:
            stem = uuid[:8]
        filename = f"{stem}.{ext}"
        n = 2
        while filename in used:
            filename = f"{stem}-{n}.{ext}"
            n += 1
        used.add(filename)
        (outdir / filename).write_bytes(raw)
        written[uuid] = filename

    page = template
    for uuid, filename in written.items():
        page = page.replace(uuid, f"/{name}/{filename}")

    by_stem = {v.rsplit(".", 1)[0]: v for v in written.values()}
    resources = {}
    if "react" in by_stem:
        resources[REACT_URL] = f"/{name}/{by_stem['react']}"
    if "react-dom" in by_stem:
        resources[REACT_DOM_URL] = f"/{name}/{by_stem['react-dom']}"
    if "world-atlas" in by_stem:
        resources["worldAtlas"] = f"/{name}/{by_stem['world-atlas']}"

    shim = (
        "<script>window.__resources = "
        + json.dumps(resources, indent=2)
        + ";</script>\n"
    )
    # Must run before dc-runtime, which reads __resources during its own load.
    page = page.replace("<head>", "<head>\n" + shim, 1)

    # The exported page is built to stand alone at full viewport height. Framed,
    # `min-height:100vh` would hold the document at the iframe's height however
    # small the graphic scaled, so the reported height could never shrink and
    # the parent would leave dead space under it. Percentage padding replaces
    # the fixed 60px so the breathing room (and the room the drop shadows need)
    # scales with the graphic instead of swamping it on a phone.
    before = page
    page = page.replace(
        "min-height:100vh;background:#ffffff;font-family:'Mona Sans'",
        "background:#ffffff;font-family:'Mona Sans'",
        1,
    ).replace("padding:60px 32px 0;box-sizing:border-box", "padding:2.5% 2.5% 3.5%;box-sizing:border-box", 1)
    if page == before:
        print("  ! sizing patch did not apply — the export's root style changed.")

    page = page.replace("</body>", UNPIN_CSS + REPORT_JS + "</body>", 1)

    target = ROOT / "public" / f"{name}.html"
    target.write_text(page, encoding="utf8")

    total = sum((outdir / f).stat().st_size for f in written.values())
    print(f"{target.relative_to(ROOT)}  {target.stat().st_size:,} bytes")
    for uuid, filename in sorted(written.items(), key=lambda kv: kv[1]):
        print(f"  {name}/{filename:<28} {(outdir / filename).stat().st_size:>9,}")
    print(f"  {'assets total':<30} {total:>9,}")
    print(f"  bundle was {bundle.stat().st_size:,} bytes as one file")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    unpack(pathlib.Path(sys.argv[1]), sys.argv[2])

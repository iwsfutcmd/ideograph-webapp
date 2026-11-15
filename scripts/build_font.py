#!/usr/bin/env python3
"""Build the GlyphWiki webfont for the web app.

Downloads Jigmo (字雲, https://kamichikoichi.github.io/jigmo/), a CC0 font
generated from GlyphWiki (https://glyphwiki.org/) data that covers every CJK
unified ideograph through Unicode 17.0, and splits it into small WOFF2 files
with CSS ``unicode-range`` rules, so a browser only downloads the pieces that
contain characters it actually has to draw.

Characters in the app's data that Jigmo lacks (e.g. Unicode 18.0 additions)
are fetched as SVG glyphs from GlyphWiki itself and put in a small
supplementary font.  That step is best-effort: if GlyphWiki cannot be reached,
the build continues without it.

Output (served as static files; not committed):

    public/fonts/glyphwiki.css
    public/fonts/jigmo-<version>/*.woff2
    public/fonts/glyphwiki-supplement.woff2

Usage::

    pip install -r scripts/requirements.txt
    python3 scripts/build_font.py
"""

from __future__ import annotations

import hashlib
import io
import re
import shutil
import sys
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import uharfbuzz as hb
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont, woff2
from fontTools.ttLib.removeOverlaps import removeOverlaps

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "fonts"
OUT = ROOT / "public" / "fonts"
DATA = ROOT / "src" / "data" / "ideographs.txt"

JIGMO_VERSION = "20250912"
JIGMO_URL = f"https://kamichikoichi.github.io/jigmo/Jigmo-{JIGMO_VERSION}.zip"
JIGMO_SHA256 = "5744c7386d129475d87607ca66d043c8793c65448adeaedc921b6931890e5d0b"
JIGMO_FILES = ("Jigmo.ttf", "Jigmo2.ttf", "Jigmo3.ttf")
GLYPHWIKI_SVG = "https://glyphwiki.org/glyph/u{cp:04x}.svg"

FAMILY = "Ideograph Jigmo"
SUPPLEMENT_FAMILY = "Ideograph GlyphWiki"
#: Glyphs per WOFF2 file (~20 KB each).
CHUNK_SIZE = 100
#: Code points taken from Jigmo: CJK radicals, IDS operators, CJK symbols,
#: strokes, unified and compatibility ideographs (not Latin etc., so UI text
#: keeps its own font).
RANGES = [
    (0x2E80, 0x2FDF),  # CJK Radicals Supplement, Kangxi Radicals
    (0x2FF0, 0x2FFF),  # Ideographic Description Characters
    (0x3000, 0x303F),  # CJK Symbols and Punctuation
    (0x31C0, 0x31EF),  # CJK Strokes
    (0x3400, 0x4DBF),  # Ext. A
    (0x4E00, 0x9FFF),  # URO
    (0xF900, 0xFAFF),  # CJK Compatibility Ideographs
    (0x20000, 0x3FFFF),  # SIP and TIP: Ext. B–J, compatibility supplement
]

USER_AGENT = "ideograph-webapp font build (+https://github.com/iwsfutcmd/ideograph-webapp)"


def in_ranges(cp: int) -> bool:
    return any(lo <= cp <= hi for lo, hi in RANGES)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def jigmo_fonts() -> Path:
    """Download (once), verify and unpack Jigmo; return the directory."""
    unpacked = CACHE / f"jigmo-{JIGMO_VERSION}"
    if all((unpacked / name).exists() for name in JIGMO_FILES):
        return unpacked
    archive = CACHE / f"Jigmo-{JIGMO_VERSION}.zip"
    if not archive.exists():
        print(f"downloading {JIGMO_URL}", file=sys.stderr)
        CACHE.mkdir(parents=True, exist_ok=True)
        archive.write_bytes(fetch(JIGMO_URL))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != JIGMO_SHA256:
        archive.unlink()
        sys.exit(f"{archive.name}: SHA-256 {digest} does not match the pinned {JIGMO_SHA256}")
    with zipfile.ZipFile(archive) as zf:
        for name in (*JIGMO_FILES, "LICENSE.txt", "README.txt"):
            zf.extract(name, unpacked)
    return unpacked


# ---------------------------------------------------------------------------
# Jigmo chunks

_faces: dict[str, hb.Face] = {}


def _init_worker(src: str) -> None:
    for name in JIGMO_FILES:
        _faces[name] = hb.Face(hb.Blob.from_file_path(str(Path(src) / name)))


def _build_chunk(job: tuple[str, list[int], str]) -> int:
    font_name, cps, dest = job
    inp = hb.SubsetInput()
    inp.unicode_set.update(cps)
    inp.flags |= hb.SubsetFlags.NO_HINTING
    subset = hb.subset(_faces[font_name], inp)
    out = io.BytesIO()
    woff2.compress(io.BytesIO(subset.blob.data), out)
    Path(dest).write_bytes(out.getvalue())
    return len(out.getvalue())


def unicode_range(cps: list[int]) -> str:
    lo, hi = min(cps), max(cps)
    return f"U+{lo:X}" if lo == hi else f"U+{lo:X}-{hi:X}"


def build_jigmo(src: Path) -> tuple[list[str], set[int]]:
    dest_dir = OUT / f"jigmo-{JIGMO_VERSION}"
    dest_dir.mkdir(parents=True)
    shutil.copy(src / "LICENSE.txt", dest_dir / "LICENSE.txt")
    shutil.copy(src / "README.txt", dest_dir / "README.txt")

    jobs = []
    covered: set[int] = set()
    for name in JIGMO_FILES:
        cmap = TTFont(src / name, lazy=True).getBestCmap()
        cps = sorted(cp for cp in cmap if in_ranges(cp) and cp not in covered)
        covered.update(cps)
        for i in range(0, len(cps), CHUNK_SIZE):
            chunk = cps[i : i + CHUNK_SIZE]
            jobs.append((name, chunk, str(dest_dir / f"u{chunk[0]:x}.woff2")))

    print(f"writing {len(jobs)} Jigmo subsets for {len(covered)} code points…", file=sys.stderr)
    with ProcessPoolExecutor(initializer=_init_worker, initargs=(str(src),)) as pool:
        sizes = list(pool.map(_build_chunk, jobs, chunksize=8))
    print(f"  {sum(sizes) / 1e6:.1f} MB in total", file=sys.stderr)

    rules = [
        f'@font-face{{font-family:"{FAMILY}";src:url(jigmo-{JIGMO_VERSION}/{Path(dest).name}) format("woff2");'
        f"unicode-range:{unicode_range(cps)};font-display:swap}}"
        for _, cps, dest in jobs
    ]
    return rules, covered


# ---------------------------------------------------------------------------
# GlyphWiki supplement for characters Jigmo lacks

UPM = 1024
ASCENT, DESCENT = 880, 144  # Jigmo's typographic metrics; GlyphWiki's 200×200 box maps onto them


def needed_code_points() -> set[int]:
    cps: set[int] = set()
    for line in DATA.read_text("utf-8").splitlines():
        fields = line.split("\t")
        cps.add(ord(fields[0]))
        for seq in fields[2::2]:
            cps.update(ord(c) for c in seq)
    return {cp for cp in cps if in_ranges(cp)}


def build_supplement(missing: list[int]) -> list[str]:
    svgs: dict[int, str] = {}
    for cp in missing:
        cached = CACHE / "glyphwiki" / f"u{cp:x}.svg"
        try:
            if not cached.exists():
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_bytes(fetch(GLYPHWIKI_SVG.format(cp=cp)))
            svgs[cp] = cached.read_text("utf-8")
        except (urllib.error.URLError, OSError) as exc:
            print(f"  warning: no GlyphWiki glyph for U+{cp:04X}: {exc}", file=sys.stderr)
    if not svgs:
        return []

    names = [".notdef"] + [f"uni{cp:04X}" if cp <= 0xFFFF else f"u{cp:X}" for cp in svgs]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    scale = UPM / 200
    for cp, name in zip(svgs, names[1:]):
        pen = TTGlyphPen(None)
        # SVG y runs downwards from the top of the 200×200 em box.
        tpen = TransformPen(pen, (scale, 0, 0, -scale, 0, ASCENT))
        for d in re.findall(r'\sd="([^"]+)"', svgs[cp]):
            parse_path(d, tpen)
        for points in re.findall(r'points="([^"]+)"', svgs[cp]):
            nums = [float(n) for n in re.split(r"[\s,]+", points.strip())]
            tpen.moveTo((nums[0], nums[1]))
            for i in range(2, len(nums), 2):
                tpen.lineTo((nums[i], nums[i + 1]))
            tpen.closePath()
        glyphs[name] = pen.glyph()

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(dict(zip(svgs, names[1:])))
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({n: (UPM, 0) for n in names})
    fb.setupHorizontalHeader(ascent=ASCENT, descent=-DESCENT)
    fb.setupVerticalMetrics({n: (UPM, 0) for n in names})
    fb.setupVerticalHeader(ascent=UPM // 2, descent=-UPM // 2)
    fb.setupNameTable({"familyName": SUPPLEMENT_FAMILY, "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=-DESCENT, usWinAscent=ASCENT, usWinDescent=DESCENT)
    fb.setupPost()
    font = fb.font
    # KAGE strokes overlap; merge them so the outlines fill correctly.
    removeOverlaps(font)
    glyf = font["glyf"]
    for name in names[1:]:
        glyph = glyf[name]
        glyph.recalcBounds(glyf)
        # Vertical origin at the top of the em box: top side bearing = ascent − yMax.
        font["vmtx"][name] = (UPM, ASCENT - glyph.yMax if glyph.numberOfContours else 0)
    font.flavor = "woff2"
    font.save(OUT / "glyphwiki-supplement.woff2")
    print(f"  GlyphWiki supplement: {len(svgs)} glyph(s): "
          + " ".join(f"U+{cp:04X}" for cp in svgs), file=sys.stderr)
    return [
        f'@font-face{{font-family:"{SUPPLEMENT_FAMILY}";src:url(glyphwiki-supplement.woff2) format("woff2");'
        f'unicode-range:{",".join(f"U+{cp:X}" for cp in svgs)};font-display:swap}}'
    ]


def main() -> None:
    src = jigmo_fonts()
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    rules, covered = build_jigmo(src)
    missing = sorted(needed_code_points() - covered)
    print(f"{len(missing)} character(s) in the data are not in Jigmo", file=sys.stderr)
    rules += build_supplement(missing)
    header = (
        f"/* Jigmo {JIGMO_VERSION} (CC0, https://kamichikoichi.github.io/jigmo/), "
        "built from GlyphWiki (https://glyphwiki.org/) glyphs. Generated by scripts/build_font.py. */\n"
    )
    (OUT / "glyphwiki.css").write_text(header + "\n".join(rules) + "\n", encoding="utf-8")
    print(f"wrote {OUT / 'glyphwiki.css'} ({len(rules)} rules)", file=sys.stderr)


if __name__ == "__main__":
    main()

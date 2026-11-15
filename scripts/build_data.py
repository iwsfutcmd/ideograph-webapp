#!/usr/bin/env python3
"""Export the data bundled with the `ideograph` Python package for the web app.

Writes:

* ``src/data/ideographs.txt`` — one line per ideograph, tab-separated:
  ``character, total strokes, IDS₁, sources₁, IDS₂, sources₂, …``
* ``src/data/meta.json`` — provenance, radical aliases and stroke counts for
  components that are not ideographs themselves (CJK strokes, radical forms).

Requires ideograph ≥ 2.0::

    pip install "ideograph @ git+https://github.com/iwsfutcmd/ideograph"
    python3 scripts/build_data.py
"""

from __future__ import annotations

import json
from pathlib import Path

import ideograph
from ideograph import ids_syntax

OUT = Path(__file__).resolve().parent.parent / "src" / "data"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    entries = set()
    components = set()
    lines = []
    for char in ideograph.ideographs():
        entries.add(char)
        strokes = ideograph.total_strokes(char)
        fields = [char, "" if strokes is None else str(strokes)]
        for seq in ideograph.ids(char):
            if "\t" in seq.sequence or "\n" in seq.sequence:
                raise ValueError(f"unexpected whitespace in IDS for {char}")
            fields += [seq.sequence, seq.sources]
            components |= ids_syntax.components(seq.sequence)
        lines.append("\t".join(fields))

    component_strokes = {}
    for char in sorted(components - entries, key=ord):
        strokes = ideograph.total_strokes(char)
        if strokes is not None:
            component_strokes[char] = strokes

    (OUT / "ideographs.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    meta = {
        "library_version": ideograph.__version__,
        "info": ideograph.data_info(),
        "aliases": ideograph.aliases(),
        "component_strokes": component_strokes,
    }
    (OUT / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(lines)} ideographs to {OUT}")


if __name__ == "__main__":
    main()

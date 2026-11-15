# ideograph-webapp

Web interface for [ideograph](https://github.com/iwsfutcmd/ideograph): find
Han characters (漢字) by their components.

**<https://iwsfutcmd.github.io/ideograph-webapp/>**

Type components (e.g. `木日勿`) or pick them from the palette, and every
character that contains all of them is listed, ordered by stroke count. Each
character shows its Ideographic Description Sequences (with IRG source
references), its components (click one to add it to the search), and links to
Wiktionary, the Unihan Database, zi.tools, GlyphWiki and PanLex.

The search runs entirely in the browser, so the site is a static page hosted on
GitHub Pages. The old server version (Sanic + Redis, last deployed on Heroku)
is in the git history before 2.0.0; its site-wide “common components” counter
is replaced by a static palette of the most productive components plus a
per-browser list of recently used ones (stored in `localStorage`).

## Coverage

All 101,997 CJK unified ideographs in **Unicode 18.0**, including Extension J.
See the [ideograph data notes](https://github.com/iwsfutcmd/ideograph/blob/master/DATA.md)
for sources. To see characters from the newer extensions you need a font that
covers them, such as BabelStone Han, Jigmo or Plangothic.

## Internationalization

* **UI languages:** English, Chinese (Simplified and Traditional), Japanese,
  Korean, Vietnamese and Arabic. The language is negotiated from the browser
  and can be changed in Settings. Plurals use CLDR plural categories
  (`Intl.PluralRules`), numbers and dates are formatted with `Intl`, and
  interpolated values are wrapped in Unicode bidi isolates.
* **RTL:** the page direction follows the UI language, and all layout uses
  CSS logical properties.
* **Vertical text:** Settings → Layout → Vertical lays out the whole page
  top-to-bottom, right-to-left (`writing-mode: vertical-rl`).
* **Glyph forms:** Han text is tagged with a language (Mainland China, Taiwan,
  Hong Kong, Japan, Korea, Vietnam, or automatic from the UI language), so the
  browser picks fonts with the matching regional glyph forms.

The non-English translations were drafted by Claude and should be checked by
native speakers. To add a language, copy `src/locales/en.ts`, translate it, and
register it in `CATALOGUES` in `src/i18n.ts`; the tests check that every
catalogue has the same keys and placeholders as English.

## Development

```bash
npm install
npm run dev      # development server
npm test         # unit tests (vitest)
npm run build    # production build in dist/
```

### Updating the data

The character data in `src/data/` is exported from the `ideograph` Python
package (≥ 2.0):

```bash
pip install "ideograph @ git+https://github.com/iwsfutcmd/ideograph"
npm run data     # runs scripts/build_data.py
```

## Deployment

`.github/workflows/pages.yml` tests and builds every push, and deploys pushes to
`master` to GitHub Pages. GitHub Pages must be enabled once for the repository:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Licence

The code is MIT-licensed (see [LICENSE](LICENSE)). The character data in
`src/data/` includes data derived from CHISE IDS and is distributed under the
[GNU GPL, version 2 or later](LICENSES/GPL-2.0-or-later.txt); it also includes
data from the Unicode Character Database
([Unicode License v3](LICENSES/Unicode-3.0.txt)).

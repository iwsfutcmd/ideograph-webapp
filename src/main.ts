import { IdeographData, loadData, type SearchResult } from "./data";
import { Translator, UI_LOCALES, negotiate } from "./i18n";
import meta from "./data/meta.json";
import dataUrl from "./data/ideographs.txt?url";

// ---------------------------------------------------------------------------
// Settings (persisted in localStorage when available)

type Layout = "horizontal" | "vertical";
type HanFont = "system" | "glyphwiki";

interface Settings {
  uiLocale: string | null; // null: follow the browser
  glyphLocale: string; // "auto" or a BCP 47 tag
  hanFont: HanFont; // system fonts first, or GlyphWiki (Jigmo) for everything
  layout: Layout;
}

const SETTINGS_KEY = "ideograph-webapp:settings";
const RECENT_KEY = "ideograph-webapp:recent";
const RECENT_MAX = 40;
const PAGE_SIZE = 300;
const COMMON_COUNT = 120;

/** Glyph-form locales offered for Han text, with the region used to label them. */
const GLYPH_LOCALES: { tag: string; region: string }[] = [
  { tag: "zh-Hans-CN", region: "CN" },
  { tag: "zh-Hant-TW", region: "TW" },
  { tag: "zh-Hant-HK", region: "HK" },
  { tag: "ja-JP", region: "JP" },
  { tag: "ko-KR", region: "KR" },
  { tag: "vi-VN", region: "VN" },
];

/**
 * Common system CJK fonts per glyph region (macOS, Windows, Linux/Android).
 * They are tried after the generic sans-serif family, the selected region's
 * fonts first, so regional glyph forms are kept even in browsers whose
 * generic family ignores the lang attribute; anything none of them cover
 * falls through to the GlyphWiki webfont.
 */
const SYSTEM_HAN_FONTS: Record<string, string[]> = {
  "zh-Hant": ["PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", "Source Han Sans TC", "PMingLiU", "PMingLiU-ExtB", "MingLiU-ExtB"],
  "zh-Hans": ["PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Zen Hei", "SimSun", "SimSun-ExtB", "SimSun-ExtG"],
  "zh-HK": ["PingFang HK", "Noto Sans CJK HK", "Noto Sans HK", "Source Han Sans HC", "MingLiU_HKSCS", "MingLiU_HKSCS-ExtB"],
  ja: ["Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "YuGothic", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP", "Source Han Sans JP"],
  ko: ["Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR", "Source Han Sans KR"],
  vi: ["Nom Na Tong", "Han Nom A", "Han Nom B"],
};

function systemHanFonts(lang: string): string {
  const region = lang.startsWith("zh-Hans")
    ? "zh-Hans"
    : lang.startsWith("zh-Hant-HK")
      ? "zh-HK"
      : lang.startsWith("zh")
        ? "zh-Hant"
        : lang.split("-")[0];
  const order = [region, ...Object.keys(SYSTEM_HAN_FONTS).filter((r) => r !== region)];
  const fonts = new Set(order.flatMap((r) => SYSTEM_HAN_FONTS[r] ?? []));
  return [...fonts].map((f) => `"${f}"`).join(", ");
}

/** UI locale → Wiktionary edition. */
const WIKTIONARY: Record<string, string> = {
  en: "en", "zh-Hans": "zh", "zh-Hant": "zh", ja: "ja", ko: "ko", vi: "vi", ar: "ar",
};

function storageGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private browsing, quota): settings are per-visit */
  }
}

const settings: Settings = storageGet<Settings>(SETTINGS_KEY, {
  uiLocale: null,
  glyphLocale: "auto",
  hanFont: "system",
  layout: "horizontal",
});
let recent: string[] = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : [];
  } catch {
    return [];
  }
})();

// ---------------------------------------------------------------------------
// DOM

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const root = document.documentElement;
const componentsInput = $<HTMLInputElement>("components");
const scratchpad = $<HTMLInputElement>("scratchpad");
const statusEl = $<HTMLParagraphElement>("status");
const ignoredEl = $<HTMLParagraphElement>("ignored");
const resultsEl = $<HTMLUListElement>("results");
const showMoreBtn = $<HTMLButtonElement>("show-more");
const commonEl = $<HTMLUListElement>("common");
const recentEl = $<HTMLUListElement>("recent");
const recentBlock = $<HTMLDivElement>("recent-block");
const uiLocaleSelect = $<HTMLSelectElement>("ui-locale");
const glyphLocaleSelect = $<HTMLSelectElement>("glyph-locale");
const hanFontSelect = $<HTMLSelectElement>("han-font");
const dialog = $<HTMLDialogElement>("details");

let t = new Translator(settings.uiLocale ?? negotiate(navigator.languages));
let data: IdeographData | null = null;
let loadFailed = false;
let result: SearchResult | null = null;
let shown = 0;
let detailsChar = "";

const codePoint = (c: string): string =>
  "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");

/** The language tag used for Han text (affects glyph selection in fonts). */
function glyphLang(): string {
  if (settings.glyphLocale !== "auto") return settings.glyphLocale;
  const fromUi: Record<string, string> = {
    "zh-Hans": "zh-Hans-CN", "zh-Hant": "zh-Hant-TW", ja: "ja-JP", ko: "ko-KR", vi: "vi-VN",
  };
  if (fromUi[t.locale]) return fromUi[t.locale];
  for (const tag of navigator.languages) {
    const lang = tag.split("-")[0];
    if (["zh", "ja", "ko", "vi"].includes(lang)) return tag;
  }
  return "und-Hani";
}

function chip(char: string, onClick: "add" | "details" = "add", occurrences = 1): HTMLLIElement {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = onClick === "add" ? "chip" : "ideo";
  button.dataset.char = char;
  button.dataset.action = onClick;
  button.textContent = char;
  const strokes = data?.strokeCount(char);
  const label = onClick === "add" ? t.t("addComponent", { char }) : t.t("showDetails", { char });
  const facts = [codePoint(char)];
  if (strokes !== undefined) facts.push(t.plural("strokes", strokes));
  if (occurrences > 1) {
    facts.push(t.plural("occurrences", occurrences));
    // Visible multiplicity badge; the count is also in the title for AT.
    const badge = document.createElement("span");
    badge.className = "count";
    badge.setAttribute("aria-hidden", "true");
    badge.dir = "ltr";
    badge.textContent = "×" + t.n(occurrences);
    button.append(badge);
  }
  button.title = `${facts.join(" · ")}\n${label}`;
  li.append(button);
  return li;
}

// ---------------------------------------------------------------------------
// Rendering

function applyStaticText(): void {
  root.lang = t.locale;
  root.dir = t.dir;
  root.dataset.layout = settings.layout;
  document.title = t.t("title");
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = t.t(el.dataset.i18n as Parameters<Translator["t"]>[0], { example: "木木" });
  }
  const info = meta.info;
  $("data-sources").textContent = t.t("dataSources", {
    unicode: t.t("unicodeVersion", { version: info.unicode_version }),
    babelstone: t.t("babelstoneVersion", { date: t.date(info.babelstone_file_date) }),
    chise: t.t("chiseVersion", { commit: info.chise_commit.slice(0, 7) }),
  });

  uiLocaleSelect.replaceChildren(
    ...UI_LOCALES.map((code) => {
      const option = new Option(new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code, code);
      option.lang = code;
      option.selected = code === t.locale;
      return option;
    }),
  );
  const regions = new Intl.DisplayNames([t.locale], { type: "region", style: "short" });
  glyphLocaleSelect.replaceChildren(
    new Option(t.t("glyphAuto"), "auto", false, settings.glyphLocale === "auto"),
    ...GLYPH_LOCALES.map(({ tag, region }) => {
      const option = new Option(regions.of(region) ?? tag, tag, false, settings.glyphLocale === tag);
      return option;
    }),
  );
  hanFontSelect.replaceChildren(
    new Option(t.t("hanFontSystem"), "system", false, settings.hanFont === "system"),
    new Option(t.t("hanFontGlyphWiki"), "glyphwiki", false, settings.hanFont === "glyphwiki"),
  );
  root.dataset.hanFont = settings.hanFont;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="layout"]')) {
    radio.checked = radio.value === settings.layout;
  }
  applyGlyphLang();
}

function applyGlyphLang(): void {
  const lang = glyphLang();
  root.style.setProperty("--han-system", systemHanFonts(lang));
  for (const el of document.querySelectorAll<HTMLElement>(".han")) el.lang = lang;
}

function renderStatus(): void {
  ignoredEl.hidden = true;
  if (loadFailed) {
    statusEl.textContent = t.t("loadError");
    return;
  }
  if (!data || !result) {
    statusEl.textContent = t.t("loading");
    return;
  }
  if (result.ignored.length) {
    ignoredEl.hidden = false;
    ignoredEl.textContent = t.t("ignoredComponents", { chars: result.ignored.join(" ") });
  }
  if (!result.used.length) statusEl.textContent = t.t("emptyQuery");
  else if (!result.chars.length) statusEl.textContent = t.t("noResults");
  else statusEl.textContent = t.plural("resultCount", result.chars.length);
}

function renderResults(): void {
  resultsEl.replaceChildren();
  shown = 0;
  renderMore();
}

function renderMore(): void {
  if (!result) return;
  const next = result.chars.slice(shown, shown + PAGE_SIZE);
  resultsEl.append(...next.map((c) => chip(c, "details")));
  shown += next.length;
  const remaining = result.chars.length - shown;
  showMoreBtn.hidden = remaining <= 0;
  if (remaining > 0) showMoreBtn.textContent = t.plural("showMore", Math.min(remaining, PAGE_SIZE));
}

function renderPalettes(): void {
  if (data) commonEl.replaceChildren(...data.commonComponents(COMMON_COUNT).map((c) => chip(c)));
  recentBlock.hidden = recent.length === 0;
  recentEl.replaceChildren(...recent.map((c) => chip(c)));
}

function renderAll(): void {
  applyStaticText();
  renderStatus();
  renderResults();
  renderPalettes();
  if (dialog.open) openDetails(detailsChar);
}

// ---------------------------------------------------------------------------
// Search

let searchTimer = 0;
let recentTimer = 0;

function search(): void {
  const query = componentsInput.value;
  const url = new URL(location.href);
  if (query) url.searchParams.set("components", query);
  else url.searchParams.delete("components");
  history.replaceState(null, "", url);

  if (!data) return renderStatus();
  result = data.find(query);
  renderStatus();
  renderResults();

  clearTimeout(recentTimer);
  const used = result.used;
  if (used.length) {
    recentTimer = window.setTimeout(() => {
      recent = [...new Set([...used, ...recent])].slice(0, RECENT_MAX);
      storageSet(RECENT_KEY, recent);
      renderPalettes();
    }, 1500);
  }
}

function scheduleSearch(): void {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(search, 120);
}

function addComponent(char: string): void {
  componentsInput.value += char;
  search();
}

// ---------------------------------------------------------------------------
// Details dialog

function openDetails(char: string): void {
  if (!data) return;
  detailsChar = char;
  $("details-char").textContent = char;
  $("details-codepoint").textContent = codePoint(char);
  const strokes = data.strokeCount(char);
  $("details-strokes").textContent =
    strokes === undefined ? t.t("strokesUnknown") : t.plural("strokes", strokes);

  $("details-ids").replaceChildren(
    ...data.ids(char).map(({ sequence, sources }) => {
      const li = document.createElement("li");
      const seq = document.createElement("span");
      seq.className = "han ids";
      // IDS are prefix expressions read left to right; the operators are
      // bidi-neutral, so isolate them as LTR inside RTL text.
      seq.dir = "ltr";
      seq.lang = glyphLang();
      seq.textContent = sequence;
      li.append(seq);
      if (sources) {
        const src = document.createElement("span");
        src.className = "sources";
        src.textContent = t.t("sourcesLabel", { sources });
        li.append(" ", src);
      }
      return li;
    }),
  );

  const fill = (id: string, chars: string[], counted = false): void => {
    const el = $(id);
    if (chars.length) el.replaceChildren(...chars.map((c) => chip(c, "add", counted ? data!.countIn(char, c) : 1)));
    else {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = t.t("noComponents");
      el.replaceChildren(li);
    }
  };
  fill("details-direct", data.components(char, false));
  fill("details-all", data.components(char), true);

  const enc = encodeURIComponent(char);
  const hex = char.codePointAt(0)!.toString(16).toUpperCase();
  const links: [string, string][] = [
    [t.t("linkWiktionary"), `https://${WIKTIONARY[t.locale] ?? "en"}.wiktionary.org/wiki/${enc}`],
    [t.t("linkUnihan"), `https://www.unicode.org/cgi-bin/GetUnihanData.pl?codepoint=${hex}`],
    [t.t("linkZiTools"), `https://zi.tools/zi/${enc}`],
    [t.t("linkGlyphWiki"), `https://glyphwiki.org/wiki/u${hex.toLowerCase()}`],
  ];
  $("details-links").replaceChildren(
    ...links.map(([label, href]) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = label;
      li.append(a);
      return li;
    }),
  );
  applyGlyphLang();
  if (!dialog.open) dialog.showModal();
}

// ---------------------------------------------------------------------------
// Events

componentsInput.addEventListener("input", (e) => {
  if (!(e as InputEvent).isComposing) scheduleSearch();
});
componentsInput.addEventListener("compositionend", scheduleSearch);
$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(searchTimer);
  search();
});
$("clear-components").addEventListener("click", () => {
  componentsInput.value = "";
  search();
  componentsInput.focus();
});

function flash(button: HTMLButtonElement): void {
  button.textContent = t.t("copied");
  setTimeout(() => (button.textContent = t.t("copy")), 1500);
}
async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    flash(button);
  } catch {
    /* clipboard not permitted; the text is still selectable */
  }
}
$("copy-scratchpad").addEventListener("click", (e) =>
  copy(scratchpad.value, e.currentTarget as HTMLButtonElement),
);
$("details-copy").addEventListener("click", (e) => copy(detailsChar, e.currentTarget as HTMLButtonElement));
$("details-scratchpad").addEventListener("click", () => {
  scratchpad.value += detailsChar;
});
$("clear-recent").addEventListener("click", () => {
  recent = [];
  storageSet(RECENT_KEY, recent);
  renderPalettes();
});
showMoreBtn.addEventListener("click", renderMore);

document.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>("button[data-char]");
  if (!button) return;
  const char = button.dataset.char!;
  if (button.dataset.action === "details") openDetails(char);
  else {
    if (dialog.open) dialog.close();
    addComponent(char);
  }
});
// Close the dialog when its backdrop is clicked.
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

uiLocaleSelect.addEventListener("change", () => {
  settings.uiLocale = uiLocaleSelect.value;
  storageSet(SETTINGS_KEY, settings);
  t = new Translator(settings.uiLocale);
  renderAll();
});
glyphLocaleSelect.addEventListener("change", () => {
  settings.glyphLocale = glyphLocaleSelect.value;
  storageSet(SETTINGS_KEY, settings);
  applyGlyphLang();
});
hanFontSelect.addEventListener("change", () => {
  settings.hanFont = hanFontSelect.value as HanFont;
  storageSet(SETTINGS_KEY, settings);
  root.dataset.hanFont = settings.hanFont;
});
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="layout"]')) {
  radio.addEventListener("change", () => {
    settings.layout = radio.value as Layout;
    storageSet(SETTINGS_KEY, settings);
    root.dataset.layout = settings.layout;
  });
}

// ---------------------------------------------------------------------------
// Start

// Chromium sometimes keeps drawing "missing glyph" boxes for characters whose
// GlyphWiki font piece (unicode-range) finished loading after the text was
// laid out, until the layout boxes are rebuilt.  So after each batch of font
// loads, rebuild the boxes of the character lists (not the inputs, which
// would lose focus).
{
  const ids = ["results", "common", "recent", "details-char", "details-ids", "details-direct", "details-all"];
  let timer = 0;
  document.fonts.addEventListener("loadingdone", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.style.display = "none";
        void el.offsetHeight; // force layout
        el.style.removeProperty("display");
      }
    }, 50);
  });
}


componentsInput.value = new URLSearchParams(location.search).get("components") ?? "";
renderAll();

loadData(dataUrl, meta)
  .then((loaded) => {
    data = loaded;
    renderPalettes();
    search();
  })
  .catch((err) => {
    console.error(err);
    loadFailed = true;
    renderStatus();
  });

import { IdeographData, loadData, type SearchResult } from "./data";
import { Translator, UI_LOCALES, negotiate } from "./i18n";
import meta from "./data/meta.json";
import dataUrl from "./data/ideographs.txt?url";

// ---------------------------------------------------------------------------
// Settings (persisted in localStorage when available)

type Layout = "horizontal" | "vertical";

interface Settings {
  uiLocale: string | null; // null: follow the browser
  glyphLocale: string; // "auto" or a BCP 47 tag
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

/** UI locale → Wiktionary edition and PanLex target variety. */
const WIKTIONARY: Record<string, string> = {
  en: "en", "zh-Hans": "zh", "zh-Hant": "zh", ja: "ja", ko: "ko", vi: "vi", ar: "ar",
};
const PANLEX_TARGET: Record<string, string> = {
  en: "eng-000", "zh-Hans": "cmn-000", "zh-Hant": "cmn-001", ja: "jpn-000", ko: "kor-000", vi: "vie-000", ar: "arb-000",
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

function chip(char: string, onClick: "add" | "details" = "add"): HTMLLIElement {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = onClick === "add" ? "chip" : "ideo";
  button.dataset.char = char;
  button.dataset.action = onClick;
  button.textContent = char;
  const strokes = data?.strokeCount(char);
  const label = onClick === "add" ? t.t("addComponent", { char }) : t.t("showDetails", { char });
  button.title = `${codePoint(char)}${strokes === undefined ? "" : " · " + t.plural("strokes", strokes)}\n${label}`;
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
    el.textContent = t.t(el.dataset.i18n as Parameters<Translator["t"]>[0]);
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
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="layout"]')) {
    radio.checked = radio.value === settings.layout;
  }
  applyGlyphLang();
}

function applyGlyphLang(): void {
  const lang = glyphLang();
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

  const fill = (id: string, chars: string[]): void => {
    const el = $(id);
    if (chars.length) el.replaceChildren(...chars.map((c) => chip(c)));
    else {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = t.t("noComponents");
      el.replaceChildren(li);
    }
  };
  fill("details-direct", data.components(char, false));
  fill("details-all", data.components(char));

  const enc = encodeURIComponent(char);
  const hex = char.codePointAt(0)!.toString(16).toUpperCase();
  const target = PANLEX_TARGET[t.locale] ?? "eng-000";
  const panlex = (from: string) =>
    `https://translate.panlex.org/?langDe=${from}&langAl=${target}&txt=${enc}&trnTrn=1`;
  const links: [string, string][] = [
    [t.t("linkWiktionary"), `https://${WIKTIONARY[t.locale] ?? "en"}.wiktionary.org/wiki/${enc}`],
    [t.t("linkUnihan"), `https://www.unicode.org/cgi-bin/GetUnihanData.pl?codepoint=${hex}`],
    [t.t("linkZiTools"), `https://zi.tools/zi/${enc}`],
    [t.t("linkGlyphWiki"), `https://glyphwiki.org/wiki/u${hex.toLowerCase()}`],
    [t.t("linkPanLexCmnHans"), panlex("cmn-000")],
    [t.t("linkPanLexCmnHant"), panlex("cmn-001")],
    [t.t("linkPanLexYue"), panlex("yue-000")],
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
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="layout"]')) {
  radio.addEventListener("change", () => {
    settings.layout = radio.value as Layout;
    storageSet(SETTINGS_KEY, settings);
    root.dataset.layout = settings.layout;
  });
}

// ---------------------------------------------------------------------------
// Start

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

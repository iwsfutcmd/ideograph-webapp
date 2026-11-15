/**
 * Minimal i18n: per-locale message catalogues with CLDR plural categories
 * (via Intl.PluralRules), localized number/date formatting, text direction,
 * and Unicode bidi isolation of interpolated values.
 */

import en from "./locales/en";
import ar from "./locales/ar";
import ja from "./locales/ja";
import ko from "./locales/ko";
import vi from "./locales/vi";
import zhHans from "./locales/zh-Hans";
import zhHant from "./locales/zh-Hant";

/** A message that varies with a count; `other` is always required. */
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export type Messages = { [K in keyof typeof en]: (typeof en)[K] extends PluralMessage ? PluralMessage : string };
type PluralKey = { [K in keyof Messages]: Messages[K] extends string ? never : K }[keyof Messages];
type TextKey = Exclude<keyof Messages, PluralKey>;

export const CATALOGUES: Record<string, Messages> = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  ja,
  ko,
  vi,
  ar,
};

export const UI_LOCALES = Object.keys(CATALOGUES);
export const DEFAULT_LOCALE = "en";

/** Choose the best UI locale for a list of BCP 47 tags (e.g. navigator.languages). */
export function negotiate(preferred: readonly string[]): string {
  for (const tag of preferred) {
    let locale: Intl.Locale;
    try {
      locale = new Intl.Locale(tag).maximize();
    } catch {
      continue;
    }
    if (locale.language === "zh") return locale.script === "Hant" ? "zh-Hant" : "zh-Hans";
    if (locale.language in CATALOGUES) return locale.language;
  }
  return DEFAULT_LOCALE;
}

const RTL_SCRIPTS = new Set(["Arab", "Hebr", "Syrc", "Thaa", "Nkoo", "Adlm", "Rohg", "Mand", "Samr"]);

/** Text direction of a locale. */
export function direction(tag: string): "ltr" | "rtl" {
  const locale = new Intl.Locale(tag) as Intl.Locale & {
    getTextInfo?: () => { direction?: string };
    textInfo?: { direction?: string };
  };
  const info = locale.getTextInfo?.() ?? locale.textInfo;
  if (info?.direction === "rtl" || info?.direction === "ltr") return info.direction;
  return RTL_SCRIPTS.has(locale.maximize().script ?? "") ? "rtl" : "ltr";
}

const FSI = "⁨";
const PDI = "⁩";

export class Translator {
  readonly locale: string;
  readonly dir: "ltr" | "rtl";
  private readonly messages: Messages;
  private readonly plurals: Intl.PluralRules;
  private readonly numbers: Intl.NumberFormat;

  constructor(locale: string) {
    this.locale = locale in CATALOGUES ? locale : DEFAULT_LOCALE;
    this.messages = CATALOGUES[this.locale];
    this.dir = direction(this.locale);
    this.plurals = new Intl.PluralRules(this.locale);
    this.numbers = new Intl.NumberFormat(this.locale);
  }

  /** Format a number for this locale. */
  n(value: number): string {
    return this.numbers.format(value);
  }

  /** Format an ISO date (YYYY-MM-DD) for this locale. */
  date(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.valueOf())) return iso;
    return new Intl.DateTimeFormat(this.locale, { dateStyle: "medium", timeZone: "UTC" }).format(d);
  }

  /**
   * Look up a text message and fill in `{name}` placeholders.  String values
   * are wrapped in Unicode bidi isolates so that, e.g., Han characters or
   * Latin names embedded in Arabic text keep their own direction.
   */
  t(key: TextKey, params: Record<string, string | number> = {}): string {
    return this.fill(this.messages[key] as string, params);
  }

  /** Look up a plural message for `count` (available as `{count}`). */
  plural(key: PluralKey, count: number, params: Record<string, string | number> = {}): string {
    const forms = this.messages[key] as PluralMessage;
    // Exact zero/one/two forms only apply when the language uses them.
    const category = this.plurals.select(count);
    const template = forms[category] ?? forms.other;
    return this.fill(template, { count, ...params });
  }

  private fill(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
      if (!(name in params)) return whole;
      const value = params[name];
      return typeof value === "number" ? this.n(value) : FSI + value + PDI;
    });
  }
}

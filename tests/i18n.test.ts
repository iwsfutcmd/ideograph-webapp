import { describe, expect, it } from "vitest";
import { CATALOGUES, Translator, direction, negotiate } from "../src/i18n";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Object.values(v as object));

describe("catalogues", () => {
  const reference = CATALOGUES.en;
  for (const [locale, messages] of Object.entries(CATALOGUES)) {
    it(`${locale} has the same keys and placeholders as en`, () => {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(reference).sort());
      for (const [key, value] of Object.entries(messages)) {
        const expected = placeholders(strings(reference[key as keyof typeof reference])[0]);
        for (const s of strings(value)) {
          // Plural forms may spell out the number ("حرف واحد") instead of using {count}.
          const got = placeholders(s);
          expect(expected.filter((p) => p !== "count")).toEqual(got.filter((p) => p !== "count"));
        }
        if (typeof value !== "string") expect(value).toHaveProperty("other");
      }
    });
  }
});

describe("negotiate", () => {
  it.each([
    [["zh-TW"], "zh-Hant"],
    [["zh-HK"], "zh-Hant"],
    [["zh-CN"], "zh-Hans"],
    [["zh"], "zh-Hans"],
    [["ja-JP"], "ja"],
    [["fr", "ko"], "ko"],
    [["ar-EG"], "ar"],
    [["fr"], "en"],
    [["not a tag", "vi"], "vi"],
  ])("%j → %s", (prefs, expected) => {
    expect(negotiate(prefs)).toBe(expected);
  });
});

describe("Translator", () => {
  it("knows text direction", () => {
    expect(direction("ar")).toBe("rtl");
    expect(direction("en")).toBe("ltr");
    expect(direction("zh-Hant")).toBe("ltr");
    expect(new Translator("ar").dir).toBe("rtl");
  });

  it("uses CLDR plural categories", () => {
    const en = new Translator("en");
    expect(en.plural("resultCount", 1)).toBe("1 character");
    expect(en.plural("resultCount", 1234)).toBe("1,234 characters");
    const ar = new Translator("ar");
    expect(ar.plural("resultCount", 2)).toBe("حرفان");
    expect(ar.plural("resultCount", 5)).toContain("أحرف");
    expect(new Translator("ja").plural("resultCount", 3)).toBe("3 字");
  });

  it("isolates interpolated strings for bidi", () => {
    const ar = new Translator("ar");
    expect(ar.t("addComponent", { char: "木" })).toBe("أضف ⁨木⁩ إلى البحث");
  });

  it("falls back to English for unknown locales", () => {
    expect(new Translator("xx").locale).toBe("en");
  });
});

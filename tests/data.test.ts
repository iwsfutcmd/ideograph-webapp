import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IdeographData, type Meta } from "../src/data";

const text = readFileSync(new URL("../src/data/ideographs.txt", import.meta.url), "utf-8");
const meta = JSON.parse(readFileSync(new URL("../src/data/meta.json", import.meta.url), "utf-8")) as Meta;
const data = new IdeographData(text, meta);

describe("IdeographData", () => {
  it("loads every ideograph", () => {
    expect(data.size).toBe(Number(meta.info.count_entries));
  });

  it("finds characters containing all components", () => {
    const { chars, used, ignored } = data.find("木日勿");
    expect(chars).toContain("楊");
    expect(chars).toContain("䵘");
    expect(used.sort()).toEqual(["勿", "日", "木"].sort());
    expect(ignored).toEqual([]);
    for (const c of chars) {
      const comps = new Set([...data.components(c), c]);
      expect(["木", "日", "勿"].every((x) => comps.has(x))).toBe(true);
    }
  });

  it("sorts results by stroke count, then code point", () => {
    const { chars } = data.find("木日勿");
    const strokes = chars.map((c) => data.strokeCount(c) ?? Infinity);
    expect(strokes).toEqual([...strokes].sort((a, b) => a - b));
  });

  it("includes the component itself and is visual, not etymological", () => {
    expect(data.find("木").chars).toContain("木");
    expect(data.find("亻").chars).toContain("你");
    expect(data.find("人").chars).not.toContain("你");
  });

  it("treats a repeated component as 'at least that many'", () => {
    const two = data.find("木木");
    expect(two.required.get("木")).toBe(2);
    expect(two.chars).toEqual(expect.arrayContaining(["林", "森", "麻"]));
    expect(two.chars).not.toContain("杜");
    expect(two.chars).not.toContain("木");
    expect(data.find("木木木").chars).toContain("森");
    expect(data.find("木木木").chars).not.toContain("林");
    expect(data.find("口口口").chars).toEqual(expect.arrayContaining(["品", "器"]));
    expect(data.find("口口口口").chars).toContain("器");
    expect(data.find("口口口口").chars).not.toContain("品");
    expect(data.find("木 日 木").chars).toEqual(data.find("木木日").chars);
    expect(data.find("⽊木").chars).toEqual(two.chars);
  });

  it("counts occurrences at every depth", () => {
    expect(data.countIn("森", "木")).toBe(3);
    expect(data.countIn("森", "林")).toBe(1);
    expect(data.countIn("器", "口")).toBe(4);
    expect(data.countIn("木", "木")).toBe(1);
    expect(data.countIn("杜", "日")).toBe(0);
  });

  it("ignores decomposition links that would form cycles", () => {
    // 𫝀 = ㇯五一 ("五 minus 一") while 五 = ⿱一𫝀
    expect(data.find("五").chars).not.toContain("\u{2B740}");
    expect(data.find("五").chars).toContain("伍");
  });

  it("ignores characters that are not components", () => {
    const r = data.find("木 x⿰");
    expect(r.ignored).toEqual(["x"]);
    expect(r.chars).toEqual(data.find("木").chars);
    expect(data.find("").chars).toEqual([]);
  });

  it("normalizes radicals and compatibility ideographs", () => {
    expect(data.normalize("⽊")).toBe("木");
    expect(data.normalize("豈")).toBe("豈");
    expect(data.normalize("⺮")).toBe("𥫗");
    expect(data.find("⽊").chars).toEqual(data.find("木").chars);
  });

  it("decomposes characters", () => {
    expect(data.components("楊", false).sort()).toEqual(["木", "昜"].sort());
    expect(data.components("楊")).toEqual(expect.arrayContaining(["木", "昜", "日", "勿"]));
    expect(data.components("𬻌", false)).not.toContain("㇒");
    expect(data.ids("𧵉")).toEqual([
      { sequence: "⿰貝尔", sources: "G" },
      { sequence: "⿰貝尓", sources: "T" },
    ]);
  });

  it("covers CJK Extension J (Unicode 17)", () => {
    const char = "\u{33479}";
    expect(data.isIdeograph(char)).toBe(true);
    expect(data.find("中𱷥").chars).toContain(char);
  });

  it("offers common components", () => {
    const common = data.commonComponents(50);
    expect(common).toHaveLength(50);
    expect(common).toEqual(expect.arrayContaining(["口", "木", "氵"]));
  });
});

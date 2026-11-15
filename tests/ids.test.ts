import { describe, expect, it } from "vitest";
import { idsComponentList, idsComponents } from "../src/ids";

// Same cases as tests/test_ideograph.py::test_ids_syntax in the Python package.
describe("idsComponents", () => {
  it.each([
    ["⿰木昜", ["木", "昜"]],
    ["⿲彳山攵", ["彳", "山", "攵"]],
    ["㇯東㇒", ["東"]],
    ["⿰⿾臣臣", ["臣"]],
    ["〾⿱艹⿰？口", ["艹", "口"]],
    ["⿰木︀昜", ["木", "昜"]],
    ["木", ["木"]],
    ["⿰𠂉\u{2A6D6}", ["𠂉", "\u{2A6D6}"]],
  ])("%s", (ids, expected) => {
    expect([...idsComponents(ids)].sort()).toEqual([...expected].sort());
  });

  it("falls back to all non-operators for malformed IDS", () => {
    expect([...idsComponents("⿰木")]).toEqual(["木"]);
    expect([...idsComponents("⿰木日月")].sort()).toEqual(["日", "月", "木"].sort());
  });
});

describe("idsComponentList", () => {
  it("keeps repetitions", () => {
    expect(idsComponentList("⿱口⿰口口")).toEqual(["口", "口", "口"]);
    expect(idsComponentList("⿰木木")).toEqual(["木", "木"]);
    expect(idsComponentList("㇯⿰木木木")).toEqual(["木", "木"]);
  });
});

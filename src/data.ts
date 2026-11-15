/**
 * Client-side search over the data exported from the `ideograph` Python
 * package (see scripts/build_data.py).  Semantics follow `ideograph.find()`
 * and `ideograph.components()`.
 */

import { idsComponentList, isOperator, UNKNOWN } from "./ids";

export interface IDSRecord {
  sequence: string;
  sources: string;
}

export interface Meta {
  library_version: string;
  info: Record<string, string>;
  aliases: Record<string, string>;
  /** Decomposition links to ignore, which would otherwise form cycles. */
  cycle_breaks?: Record<string, string[]>;
  component_strokes: Record<string, number>;
}

export interface SearchResult {
  /** Matching ideographs, sorted by stroke count, then code point. */
  chars: string[];
  /** Query components that were used (distinct). */
  used: string[];
  /** How many times each used component is required (at least). */
  required: Map<string, number>;
  /** Query characters ignored because nothing contains them. */
  ignored: string[];
}

const cp = (c: string): number => c.codePointAt(0)!;

export class IdeographData {
  readonly info: Record<string, string>;
  readonly libraryVersion: string;
  private readonly strokes = new Map<string, number>();
  private readonly idsMap = new Map<string, IDSRecord[]>();
  private readonly children = new Map<string, string[]>();
  /** Per IDS (regional form): its direct components, with repetitions. */
  private readonly forms = new Map<string, string[]>();
  private readonly countCache = new Map<string, Map<string, number>>();
  private readonly parents = new Map<string, string[]>();
  private readonly aliases: Map<string, string>;
  private readonly cache = new Map<string, Set<string>>();

  constructor(text: string, meta: Meta) {
    this.info = meta.info;
    this.libraryVersion = meta.library_version;
    this.aliases = new Map(Object.entries(meta.aliases));
    for (const [c, n] of Object.entries(meta.component_strokes)) this.strokes.set(c, n);

    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const fields = line.split("\t");
      const char = fields[0];
      if (fields[1]) this.strokes.set(char, Number(fields[1]));
      const records: IDSRecord[] = [];
      const cut = meta.cycle_breaks?.[char];
      const direct = new Set<string>();
      const forms: string[] = [];
      for (let i = 2; i + 1 < fields.length; i += 2) {
        records.push({ sequence: fields[i], sources: fields[i + 1] });
        const list = idsComponentList(fields[i]).filter((c) => c !== char && !cut?.includes(c));
        for (const c of list) direct.add(c);
        if (list.length) forms.push(list.join(""));
      }
      this.idsMap.set(char, records);
      this.forms.set(char, forms);
      const kids = [...direct];
      this.children.set(char, kids);
      for (const kid of kids) {
        let list = this.parents.get(kid);
        if (!list) this.parents.set(kid, (list = []));
        list.push(char);
      }
    }
  }

  get size(): number {
    return this.idsMap.size;
  }

  /** Whether `char` is an ideograph with its own record. */
  isIdeograph(char: string): boolean {
    return this.idsMap.has(char);
  }

  /** Whether `char` can be used as a search component. */
  isKnown(char: string): boolean {
    return this.idsMap.has(char) || this.parents.has(char);
  }

  ids(char: string): IDSRecord[] {
    return this.idsMap.get(this.normalize(char)) ?? [];
  }

  strokeCount(char: string): number | undefined {
    return this.strokes.get(char);
  }

  /** Sort comparator: stroke count (unknown last), then code point. */
  readonly compare = (a: string, b: string): number => {
    const sa = this.strokes.get(a) ?? Infinity;
    const sb = this.strokes.get(b) ?? Infinity;
    return sa === sb ? cp(a) - cp(b) : sa - sb;
  };

  /**
   * NFC; Kangxi Radicals → unified ideographs (NFKC); radical and stroke
   * forms the data does not use → their equivalent unified ideograph.
   */
  normalize(text: string): string {
    let out = "";
    for (let c of text.normalize("NFC")) {
      const code = cp(c);
      if (code >= 0x2f00 && code <= 0x2fdf) c = c.normalize("NFKC");
      out += this.aliases.get(c) ?? c;
    }
    return out;
  }

  /** Every ideograph containing `component` at any depth (and itself). */
  containing(component: string): Set<string> {
    const cached = this.cache.get(component);
    if (cached) return cached;
    const found = new Set<string>();
    if (this.idsMap.has(component)) found.add(component);
    const queue = [component];
    const seen = new Set(queue);
    while (queue.length) {
      for (const parent of this.parents.get(queue.pop()!) ?? []) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        found.add(parent);
        queue.push(parent);
      }
    }
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(component, found);
    return found;
  }

  /**
   * How many times `component` occurs in `char`, at any depth (森 = ⿱木林 and
   * 林 = ⿰木木, so 木 occurs 3 times in 森).  A character counts as containing
   * itself once.  Where a character has several IDS (regional forms), the
   * largest count is used.  Mirrors `ideograph.component_counts()`.
   */
  countIn(char: string, component: string): number {
    const contains = this.containing(component);
    if (!contains.has(char)) return 0;
    let memo = this.countCache.get(component);
    if (!memo) {
      if (this.countCache.size > 16) this.countCache.delete(this.countCache.keys().next().value!);
      this.countCache.set(component, (memo = new Map()));
    }
    const stack = new Set<string>();
    const inside = (c: string): number => {
      const known = memo.get(c);
      if (known !== undefined) return known;
      if (stack.has(c)) return 0; // decomposition cycle
      stack.add(c);
      let best = 0;
      for (const form of this.forms.get(c) ?? []) {
        let total = 0;
        for (const d of form) {
          if (d === component) total += 1;
          if (contains.has(d)) total += inside(d);
        }
        if (total > best) best = total;
      }
      stack.delete(c);
      memo.set(c, best);
      return best;
    };
    return (char === component ? 1 : 0) + inside(char);
  }

  /**
   * Ideographs that contain all of the components in `query`.  A component
   * given more than once must occur at least that many times (木木 → 林, 森 …).
   */
  find(query: string): SearchResult {
    const required = new Map<string, number>();
    const ignored: string[] = [];
    for (const c of this.normalize(query)) {
      if (/\s/u.test(c) || isOperator(c) || c === UNKNOWN) continue;
      if (this.isKnown(c)) required.set(c, (required.get(c) ?? 0) + 1);
      else if (!ignored.includes(c)) ignored.push(c);
    }
    const used = [...required.keys()];
    if (!used.length) return { chars: [], used, required, ignored };
    const sets = used.map((c) => this.containing(c)).sort((a, b) => a.size - b.size);
    let chars = [...sets[0]].filter((c) => sets.every((s) => s.has(c)));
    for (const [component, n] of required) {
      if (n > 1) chars = chars.filter((c) => this.countIn(c, component) >= n);
    }
    return { chars: chars.sort(this.compare), used, required, ignored };
  }

  /** Components of `char`: direct ones only, or all of them recursively. */
  components(char: string, recursive = true): string[] {
    const start = this.normalize(char);
    const direct = this.children.get(start) ?? [];
    if (!recursive) return [...direct].sort(this.compare);
    const seen = new Set<string>();
    const queue = [...direct];
    while (queue.length) {
      const c = queue.pop()!;
      if (seen.has(c) || c === start) continue;
      seen.add(c);
      queue.push(...(this.children.get(c) ?? []));
    }
    return [...seen].sort(this.compare);
  }

  /** The `n` components with the most direct uses, by stroke count. */
  commonComponents(n: number): string[] {
    return [...this.parents.entries()]
      .sort((a, b) => b[1].length - a[1].length || cp(a[0]) - cp(b[0]))
      .slice(0, n)
      .map(([c]) => c)
      .sort(this.compare);
  }
}

export async function loadData(textUrl: string, meta: Meta): Promise<IdeographData> {
  const response = await fetch(textUrl);
  if (!response.ok) throw new Error(`${textUrl}: HTTP ${response.status}`);
  return new IdeographData(await response.text(), meta);
}

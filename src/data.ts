/**
 * Client-side search over the data exported from the `ideograph` Python
 * package (see scripts/build_data.py).  Semantics follow `ideograph.find()`
 * and `ideograph.components()`.
 */

import { idsComponents, isOperator, UNKNOWN } from "./ids";

export interface IDSRecord {
  sequence: string;
  sources: string;
}

export interface Meta {
  library_version: string;
  info: Record<string, string>;
  aliases: Record<string, string>;
  component_strokes: Record<string, number>;
}

export interface SearchResult {
  /** Matching ideographs, sorted by stroke count, then code point. */
  chars: string[];
  /** Query components that were used. */
  used: string[];
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
      const direct = new Set<string>();
      for (let i = 2; i + 1 < fields.length; i += 2) {
        records.push({ sequence: fields[i], sources: fields[i + 1] });
        for (const c of idsComponents(fields[i])) direct.add(c);
      }
      direct.delete(char);
      this.idsMap.set(char, records);
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

  /** Ideographs that contain all of the components in `query`. */
  find(query: string): SearchResult {
    const used: string[] = [];
    const ignored: string[] = [];
    for (const c of new Set(this.normalize(query))) {
      if (/\s/u.test(c) || isOperator(c) || c === UNKNOWN) continue;
      (this.isKnown(c) ? used : ignored).push(c);
    }
    if (!used.length) return { chars: [], used, ignored };
    const sets = used.map((c) => this.containing(c)).sort((a, b) => a.size - b.size);
    const chars = [...sets[0]].filter((c) => sets.every((s) => s.has(c))).sort(this.compare);
    return { chars, used, ignored };
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

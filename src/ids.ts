/**
 * Ideographic Description Sequence (IDS) parsing.
 *
 * Mirrors `ideograph.ids_syntax` in the Python package: operators are the
 * Ideographic Description Characters U+2FF0–U+2FFF (including the Unicode 15.1
 * additions ⿼⿽⿾⿿), the subtraction operator ㇯ (U+31EF) and the ideographic
 * variation indicator 〾 (U+303E).  ？ (U+FF1F) stands for an unrepresentable
 * component.
 */

export const SUBTRACTION = "㇯";
export const VARIATION_INDICATOR = "〾";
export const UNKNOWN = "？";

const ARITY = new Map<string, number>();
for (let cp = 0x2ff0; cp <= 0x2ffd; cp++) ARITY.set(String.fromCodePoint(cp), 2);
ARITY.set("⿲", 3); // ⿲
ARITY.set("⿳", 3); // ⿳
ARITY.set("⿾", 1); // ⿾ horizontal reflection
ARITY.set("⿿", 1); // ⿿ rotation
ARITY.set(SUBTRACTION, 2);
ARITY.set(VARIATION_INDICATOR, 1);

export function isOperator(char: string): boolean {
  return ARITY.has(char);
}

function isVariationSelector(char: string): boolean {
  const cp = char.codePointAt(0)!;
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}

class IDSSyntaxError extends Error {}

/**
 * The components named in one IDS (one level deep), in order and with
 * repetitions: "⿱口⿰口口" → ["口", "口", "口"].  Operators, ？ and the second
 * operand of ㇯ (the part that is removed) are not components.  A malformed
 * IDS yields every non-operator character in it.
 */
export function idsComponentList(ids: string): string[] {
  const tokens = Array.from(ids).filter((c) => !isVariationSelector(c));
  const found: string[] = [];
  let pos = 0;
  const parse = (collect: boolean): void => {
    if (pos >= tokens.length) throw new IDSSyntaxError(ids);
    const token = tokens[pos++];
    const arity = ARITY.get(token);
    if (arity === undefined) {
      if (collect && token !== UNKNOWN) found.push(token);
      return;
    }
    for (let operand = 0; operand < arity; operand++) {
      parse(collect && !(token === SUBTRACTION && operand === 1));
    }
  };
  try {
    parse(true);
    if (pos !== tokens.length) throw new IDSSyntaxError(ids);
    return found;
  } catch (e) {
    if (!(e instanceof IDSSyntaxError)) throw e;
    return tokens.filter((c) => !isOperator(c) && c !== UNKNOWN);
  }
}

/** The distinct components named in one IDS (one level deep). */
export function idsComponents(ids: string): Set<string> {
  return new Set(idsComponentList(ids));
}

import { tokenize } from "./tokenize.util.js";

export function searchSnippet(
  content: string,
  terms: readonly string[],
): string {
  const compact = content.replace(/\s+/gu, " ").trim();
  const wanted = new Set(terms);
  
  let matchOffset = 0;

  for (const match of compact.matchAll(/[\p{L}\p{N}_]+/gu)) {
    if (tokenize(match[0]).some((term) => wanted.has(term))) {
      matchOffset = match.index;
      break;
    }
  }

  let start = Math.max(0, matchOffset - 80);
  let end = Math.min(compact.length, start + 480);

  // Do not split UTF-16 surrogate pairs at either edge
  if (/[\uDC00-\uDFFF]/u.test(compact.charAt(start))) {
    start += 1;
  }
  if (/[\uDC00-\uDFFF]/u.test(compact.charAt(end))) {
    end -= 1;
  }

  return `${start ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

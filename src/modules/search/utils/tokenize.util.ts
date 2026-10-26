// Keep complete API identifiers as well as their camelCase / snake_case parts
export function tokenize(text: string): string[] {
  const result: string[] = [];

  const words = text
    .normalize("NFKC")
    .matchAll(/[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*/gu);
    
  for (const match of words) {
    const word = match[0];
    const parts = word
      .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
      .split(/[\s_]+/u);

    result.push(...new Set([word, ...parts].map((part) => part.toLowerCase())));
  }

  return result;
}

const stopWords = new Set(
  "a an the and or of to for in on with how what is are does do".split(" "),
);

export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))].filter((term) => !stopWords.has(term));
}

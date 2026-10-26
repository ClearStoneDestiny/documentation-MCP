import { expect, test } from "vitest";
import { SectionIndex } from "../../../../dist/modules/search/section-index.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";
import {
  tokenize,
  queryTerms,
} from "../../../../dist/modules/search/utils/tokenize.util.js";
import { searchSnippet } from "../../../../dist/modules/search/utils/search-snippet.util.js";

const parser = new MarkdownDocumentParser();

function document(path, content) {
  return parser.parse({
    libraryId: "nextjs",
    path,
    content,
    sourceUrl: `https://nextjs.org/docs/${path}`,
    format: "markdown",
    fetchedAt: "2026-10-26T10:00:00.000Z",
  });
}

test("tokenizes complete API names, case transitions, Unicode and underscores", () => {
  expect(
    tokenize("revalidateTag unstable_cache HTTPServer Café Ｃａｃｈｅ"),
  ).toEqual([
    "revalidatetag",
    "revalidate",
    "tag",
    "unstable_cache",
    "unstable",
    "cache",
    "httpserver",
    "http",
    "server",
    "café",
    "cache",
    "кэш",
  ]);
  expect(queryTerms("How is the revalidateTag API used?")).toEqual([
    "revalidatetag",
    "revalidate",
    "tag",
    "api",
    "used",
  ]);
});

test("indexes section bodies and code, preserving the hierarchy and source lines", () => {
  const index = new SectionIndex();
  const path = "app/guides/data";
  const parsed = document(
    path,
    "# Data\n\n## Updating\n\n### Tags\n\n```ts\nrevalidateTag('posts')\n```\n",
  );

  index.replace(parsed);
  const results = index.search(queryTerms("revalidateTag"), new Set([path]));

  expect(results[0]).toMatchObject({
    section: {
      sectionId: "tags",
      headingPath: ["Data", "Updating", "Tags"],
      startLine: 5,
      endLine: 9,
    },
    matchedTerms: ["revalidatetag", "revalidate", "tag"],
  });
  expect(results[0].section.content).toContain("revalidateTag('posts')");
});

test("ranks a matching section heading above an incidental body mention", () => {
  const index = new SectionIndex();
  index.replace(
    document(
      "app/guides/one",
      "# Guide\n\n## Revalidation\n\nConfigure behavior here.\n\n## Other\n\nAn incidental mention of revalidation here.",
    ),
  );

  const matches = index.search(["revalidation"], new Set(["app/guides/one"]));

  expect(matches.map(({ section }) => section.sectionId)).toEqual([
    "revalidation",
    "other",
  ]);
  expect(matches[0].score).toBeGreaterThan(matches[1].score);
});

test("prefers coverage of multiple query terms and returns deterministic ties", () => {
  const index = new SectionIndex();

  index.replace(document("app/b", "# Guide\n\n## Data\n\nCache storage tags."));
  index.replace(document("app/a", "# Guide\n\n## Data\n\nCache storage tags."));
  index.replace(
    document("app/c", "# Guide\n\n## Data\n\nCache storage entries."),
  );

  const paths = new Set(["app/a", "app/b", "app/c"]);
  const matches = index.search(["cache", "tags"], paths);

  expect(matches.map(({ section }) => section.path)).toEqual([
    "app/a",
    "app/b",
    "app/c",
  ]);
  expect(matches[0].matchedTerms).toEqual(["cache", "tags"]);
  expect(matches[2].matchedTerms).toEqual(["cache"]);
});

test("replaces and removes postings without retaining old section matches", () => {
  const index = new SectionIndex();

  const path = "app/a";
  const paths = new Set([path]);

  index.replace(document(path, "# Before\n\nLegacykeyword."));

  expect(index.search(["legacykeyword"], paths)).toHaveLength(1);

  index.replace(document(path, "# After\n\nNewkeyword."));

  expect(index.search(["legacykeyword"], paths)).toEqual([]);
  expect(index.search(["newkeyword"], paths)).toHaveLength(1);
  expect(index.sectionCount(paths)).toBe(1);

  index.retain(new Set());

  expect(index.search(["newkeyword"], paths)).toEqual([]);
  expect(index.sectionCount(paths)).toBe(0);
});

test("restricts candidates to the selected pages and handles empty corpora", () => {
  const index = new SectionIndex();
  index.replace(document("app/a", "# Guide\n\nMatchingkeyword."));
  index.replace(document("app/b", "# Guide\n\nMatchingkeyword."));

  expect(index.search(["matchingkeyword"], new Set(["app/a"]))).toHaveLength(1);
  expect(index.search(["missing"], new Set(["app/a"]))).toEqual([]);
  expect(index.search(["matchingkeyword"], new Set())).toEqual([]);
  expect(index.search([], new Set(["app/a"]))).toEqual([]);
});

test("snippets find body matches and keep Unicode and API identifiers intact", () => {
  const content = `## Heading\n\n${"noise ".repeat(120)}😀 revalidateTag('posts') ${"😀 tail ".repeat(120)}`;
  const snippet = searchSnippet(content, queryTerms("revalidateTag"));

  expect(snippet).toContain("revalidateTag");
  expect(snippet.startsWith("…")).toBe(true);
  expect(snippet.endsWith("…")).toBe(true);
  expect(snippet.length).toBeLessThanOrEqual(482);
  expect(snippet.isWellFormed()).toBe(true);
  expect(searchSnippet("## Heading\n\nShort text.", ["unknown"])).toBe(
    "## Heading Short text.",
  );
});

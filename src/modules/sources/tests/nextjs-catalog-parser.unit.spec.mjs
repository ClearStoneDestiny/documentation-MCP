import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseNextjsCatalog } from "../../../../dist/modules/sources/parsers/nextjs-catalog.parser.js";

const fixture = readFileSync(
  new URL("./fixtures/nextjs-llms.txt", import.meta.url),
  "utf8",
);

test("reads metadata, section links, nested entries, and optional descriptions", () => {
  expect(parseNextjsCatalog(fixture)).toEqual({
    docVersion: "99.1.0",
    documents: [
      {
        path: "app/guides",
        title: "Guides",
        sourceUrl: "https://nextjs.org/docs/app/guides",
        section: "Guides",
      },
      {
        path: "app/guides/caching",
        title: "Caching",
        sourceUrl: "https://nextjs.org/docs/app/guides/caching",
        description: "Example guide: caching data.",
        section: "Guides",
      },
      {
        path: "app/guides/nested/example",
        title: "Nested example",
        sourceUrl: "https://nextjs.org/docs/app/guides/nested/example",
        description: "A nested catalog entry.",
        section: "Guides",
      },
      {
        path: "app/guides/no-description",
        title: "No description",
        sourceUrl: "https://nextjs.org/docs/app/guides/no-description",
        section: "Guides",
      },
      {
        path: "pages/guides/example",
        title: "Pages example",
        sourceUrl: "https://nextjs.org/docs/pages/guides/example",
        description: "Example for another router.",
        section: "Pages Router",
      },
    ],
  });
});

test("normalizes Markdown URLs, anchors and trailing slashes, keeping the first duplicate", () => {
  const catalog = parseNextjsCatalog(
    [
      "- [First](/docs/app/guides/caching.md): Original description.",
      "- [Duplicate](https://nextjs.org/docs/app/guides/caching#example)",
      "- [Duplicate](/docs/app/guides/caching/)",
    ].join("\r\n"),
  );

  expect(catalog).toEqual({
    documents: [
      {
        path: "app/guides/caching",
        title: "First",
        sourceUrl: "https://nextjs.org/docs/app/guides/caching",
        description: "Original description.",
      },
    ],
  });
});

test("preserves camelCase and underscore API paths from the official index", () => {
  const catalog = parseNextjsCatalog(
    [
      "- [Cache helper](/docs/app/api-reference/functions/cacheLife)",
      "- [Legacy helper](/docs/app/api-reference/functions/unstable_cache)",
    ].join("\n"),
  );

  expect(catalog.documents.map((document) => document.path)).toEqual([
    "app/api-reference/functions/cacheLife",
    "app/api-reference/functions/unstable_cache",
  ]);
  expect(catalog.documents[0].sourceUrl).toBe(
    "https://nextjs.org/docs/app/api-reference/functions/cacheLife",
  );
});

test("ignores external, non-documentation, malformed, and unsupported URLs", () => {
  const catalog = parseNextjsCatalog(
    [
      "- [Valid](/docs/app/guides/example)",
      "- [External](https://example.com/docs/app/guides/example)",
      "- [Similar host](https://nextjs.org.example.com/docs/app/guides/example)",
      "- [Insecure](http://nextjs.org/docs/app/guides/example)",
      "- [Credentials](https://user@nextjs.org/docs/app/guides/example)",
      "- [Blog](https://nextjs.org/blog/example)",
      "- [Wrong prefix](https://nextjs.org/docs-other/example)",
      "- [Query](/docs/app/guides/example?version=old)",
      "- [Escaping docs](../../about)",
      "- [Malformed](https://[)",
      "- [Index](/docs/llms.txt)",
      "- [Sub-index](/docs/pages/llms.txt)",
      "- [Empty title]( )",
      "This is not a catalog entry.",
    ].join("\n"),
  );

  expect(catalog.documents.map((document) => document.path)).toEqual([
    "app/guides/example",
  ]);
});

test.each(["```", "~~~"])(
  "ignores links, sections, and version metadata inside %s fences",
  (fence) => {
    const catalog = parseNextjsCatalog(
      [
        `${fence}markdown`,
        "@doc-version: fake",
        "## Fake section",
        "- [Fake](/docs/app/fake)",
        fence,
        "## Actual section",
        "- [Actual](/docs/app/actual)",
      ].join("\n"),
    );

    expect(catalog.docVersion).toBeUndefined();
    expect(catalog.documents).toEqual([
      {
        path: "app/actual",
        title: "Actual",
        sourceUrl: "https://nextjs.org/docs/app/actual",
        section: "Actual section",
      },
    ]);
  },
);

test.each([
  "",
  "# No entries\n@doc-version: 99.1.0",
  "- [External](https://example.com/docs)",
])("rejects a catalog without usable documentation entries", (content) => {
  expect(() => parseNextjsCatalog(content)).toThrow(
    "No documentation entries found",
  );
});

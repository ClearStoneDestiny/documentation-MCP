import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { ReactAdapter } from "../../../../dist/modules/sources/adapters/react.adapter.js";
import { CachedMarkdownService } from "../../../../dist/modules/sources/services/cached-markdown.service.js";
import { FileCacheService } from "../../../../dist/modules/cache/file-cache.service.js";
import { LIBRARY_DEFINITIONS } from "../../../../dist/modules/libraries/constants/library-definitions.constant.js";

const catalog = readFileSync(
  new URL("./fixtures/react-llms.txt", import.meta.url),
  "utf8",
);

const document = readFileSync(
  new URL("./fixtures/react-use-state.md", import.meta.url),
  "utf8",
);

function createAdapter(overrides = {}) {
  const options = { id: "react", ...LIBRARY_DEFINITIONS.react, ...overrides };

  return new ReactAdapter(
    new CachedMarkdownService(
      new FileCacheService({
        directory: process.cwd(),
        ttlMs: 0,
        enabled: false,
      }),
      { libraryId: options.id, documentationSetId: "current" },
    ),
    options,
  );
}

afterEach(() => vi.unstubAllGlobals());

function mockText(content) {
  const fetchMock = vi.fn(
    async () =>
      new Response(content, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
  );

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

test("reads the React catalog's Markdown links, sections, API case, and root learn page", async () => {
  const fetchMock = mockText(catalog);
  const result = await createAdapter().fetchCatalog();

  expect(fetchMock.mock.calls[0][0]).toBe("https://react.dev/llms.txt");
  expect(result.libraryId).toBe("react");
  expect(result.docVersion).toBeUndefined();
  expect(result.documents.map(({ path }) => path)).toEqual([
    "learn",
    "reference/react/useState",
    "reference/react/useEffect",
    "reference/react/Fragment",
    "reference/rules/rules-of-hooks",
  ]);
  expect(result.documents[1]).toMatchObject({
    title: "useState",
    section: "Hooks",
    sourceUrl: "https://react.dev/reference/react/useState",
  });
});

test("normalizes duplicate links and excludes blog, version archives, external URLs, and nested catalogs", async () => {
  mockText(
    [
      "- [First](/reference/react/useState.md)",
      "- [Duplicate](/reference/react/useState#usage)",
      "- [Duplicate](/reference/react/useState/)",
      "- [Blog](/blog/release.md)",
      "- [Versions](/versions/18.md)",
      "- [External](https://example.com/reference/react/useState.md)",
      "- [Similar host](https://react.dev.example.com/reference/react/useState.md)",
      "- [Historical](https://18.react.dev/reference/react/useState.md)",
      "- [Credentials](https://user@react.dev/reference/react/useState.md)",
      "- [HTTP](http://react.dev/reference/react/useState.md)",
      "- [Query](/reference/react/useState.md?version=18)",
      "- [Nested catalog](/reference/llms.txt)",
      "```md",
      "- [Fenced](/learn/fake.md)",
      "```",
    ].join("\n"),
  );

  const result = await createAdapter().fetchCatalog();

  expect(result.documents).toEqual([
    {
      path: "reference/react/useState",
      title: "First",
      sourceUrl: "https://react.dev/reference/react/useState",
    },
  ]);
});

test.each([
  "learn",
  "learn/thinking-in-react",
  "reference/react/useState",
  "reference/react/experimental_taintObjectReference",
  "reference/react-dom/client/createRoot",
])("loads Markdown for the supported React path %s", async (path) => {
  const fetchMock = mockText(document);
  const result = await createAdapter().fetchDocument(path);

  expect(fetchMock.mock.calls[0][0]).toBe(`https://react.dev/${path}.md`);
  expect(result).toMatchObject({
    libraryId: "react",
    path,
    sourceUrl: `https://react.dev/${path}`,
    format: "markdown",
    content: document,
  });
});

test.each([
  "app/guides/caching",
  "blog/release",
  "versions/18",
  "../secret",
  "reference/%2e%2e/secret",
  "reference/react/useState.md",
  "reference/react/",
  "https://react.dev/learn",
  "reference/react/useState?old=1",
])(
  "rejects a path outside the React source contract before HTTP: %s",
  async (path) => {
    const fetchMock = mockText(document);

    await expect(createAdapter().fetchDocument(path)).rejects.toThrow(
      "Invalid React documentation path",
    );

    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test("uses the configured source URLs and label instead of hardcoding react.dev", async () => {
  const documentationUrl = "https://mirror.example/handbook/";
  const catalogUrl = "https://mirror.example/index.txt";

  const fetchMock = mockText(
    `- [State](${documentationUrl}reference/react/useState.md)`,
  );

  const adapter = createAdapter({
    name: "React mirror",
    documentationUrl,
    sources: { catalog: { format: "llms-txt", url: catalogUrl } },
  });
  const sets = await adapter.listDocumentationSets();

  expect(sets.documentationSets[0]).toEqual({
    id: "current",
    label: "Current React mirror documentation",
    channel: "current",
    declaredVersion: null,
    versionRange: null,
    sourceUrl: documentationUrl,
  });

  expect(fetchMock.mock.calls[0][0]).toBe(catalogUrl);

  await adapter.fetchDocument("reference/react/useState");

  expect(fetchMock.mock.lastCall[0]).toBe(
    `${documentationUrl}reference/react/useState.md`,
  );
});

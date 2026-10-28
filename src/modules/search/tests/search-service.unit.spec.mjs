import { expect, test, vi } from "vitest";
import { SearchService } from "../../../../dist/modules/search/search.service.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";
import { searchDocsOutputSchema } from "../../../../dist/modules/search/schemas/search-docs.schema.js";

const request = { library: "nextjs", query: "revalidation" };

function setup(
  contents = {
    "app/guides/data":
      "# Data\n\n## Revalidation\n\nUpdate tags with revalidateTag.\n\n## Storage\n\nKeep cache entries.",
    "app/guides/database": "# Database\n\nA separate page.",
    "pages/guides/data": "# Data\n\nLegacy router revalidation.",
  },
) {
  const catalog = {
    libraryId: "nextjs",
    sourceUrl: "https://nextjs.org/docs/llms.txt",
    fetchedAt: "2026-10-26T10:00:00.000Z",
    docVersion: "99.1.0",
    documents: Object.keys(contents).map((path) => ({
      path,
      title: path,
      sourceUrl: `https://nextjs.org/docs/${path}`,
    })),
  };

  const adapter = {
    libraryId: "nextjs",
    fetchCatalog: vi.fn(async () => catalog),
    fetchDocument: vi.fn(async (path) => ({
      libraryId: "nextjs",
      path,
      sourceUrl: `https://nextjs.org/docs/${path}`,
      content: contents[path],
      format: "markdown",
      fetchedAt: catalog.fetchedAt,
    })),
  };

  const parser = new MarkdownDocumentParser();

  vi.spyOn(parser, "parse");
  return {
    service: new SearchService(adapter, parser),
    adapter,
    parser,
    contents,
    catalog,
  };
}

test("searches sections and returns valid results with retrieval arguments and coverage", async () => {
  const { service } = setup();
  const result = await service.searchDocs(request);

  expect(searchDocsOutputSchema.safeParse(result).success).toBe(true);
  expect(result.results[0]).toMatchObject({
    path: "app/guides/data",
    sectionId: "revalidation",
    sectionTitle: "Revalidation",
    headingPath: ["Data", "Revalidation"],
    sourceUrl: "https://nextjs.org/docs/app/guides/data",
    getDocumentation: {
      library: "nextjs",
      path: "app/guides/data",
      section_id: "revalidation",
      expected_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });
  expect(result.coverage).toMatchObject({
    scope: "root-catalog",
    indexedDocuments: 3,
    indexedSections: 5,
    selectedDocuments: 3,
    catalogDocuments: 3,
    partial: false,
    failedDocuments: 0,
  });
});

test("reuses tokenized sections for unchanged content and replaces changed content", async () => {
  const { service, parser, contents, adapter } = setup();

  await service.searchDocs(request);

  expect(parser.parse).toHaveBeenCalledTimes(3);

  const unchanged = await service.searchDocs(request);

  expect(parser.parse).toHaveBeenCalledTimes(3);

  const previousHash = unchanged.results[0].contentHash;

  contents["app/guides/data"] = "# Data\n\n## Replacement\n\nNewkeyword.";
  const changed = await service.searchDocs({
    ...request,
    query: "newkeyword",
    refresh: true,
  });

  expect(parser.parse).toHaveBeenCalledTimes(4);
  expect(adapter.fetchCatalog).toHaveBeenLastCalledWith(undefined, {
    refresh: true,
  });
  expect(adapter.fetchDocument).toHaveBeenCalledWith(
    "app/guides/data",
    undefined,
    { refresh: true },
  );
  expect(changed.results[0].sectionId).toBe("replacement");
  expect(changed.results[0].contentHash).not.toBe(previousHash);
  expect(
    (await service.searchDocs(request)).results.map((result) => result.path),
  ).not.toContain("app/guides/data");
});

test.each([
  ["app/guides", ["app/guides/data", "app/guides/database"]],
  ["app/guides/data", ["app/guides/data"]],
  ["unknown", []],
])(
  "restricts loading to the exact page or subtree %s",
  async (prefix, paths) => {
    const { service, adapter } = setup();
    const result = await service.searchDocs({
      ...request,
      path_prefix: prefix,
    });

    expect(adapter.fetchDocument.mock.calls.map(([path]) => path)).toEqual(
      paths,
    );
    expect(result.coverage.selectedDocuments).toBe(paths.length);
  },
);

test("does not leak previously indexed pages into narrower searches", async () => {
  const { service, catalog } = setup();

  await service.searchDocs(request);

  const narrow = await service.searchDocs({ ...request, path_prefix: "pages" });

  expect(narrow.results.map(({ path }) => path)).toEqual(["pages/guides/data"]);

  catalog.documents = catalog.documents.filter(
    ({ path }) => path !== "app/guides/data",
  );
  const removed = await service.searchDocs(request);

  expect(removed.results.map(({ path }) => path)).toEqual([
    "pages/guides/data",
  ]);
});

test("reports source and parser failures and removes prior in-memory revisions", async () => {
  const { service, adapter, contents } = setup();

  await service.searchDocs(request);

  const original = adapter.fetchDocument.getMockImplementation();

  adapter.fetchDocument.mockImplementation(async (path, ...args) => {
    if (path === "app/guides/data") {
      throw new Error("Unavailable");
    }

    return original(path, ...args);
  });
  contents["app/guides/database"] = "---\ntitle: [invalid]\n---\n# Broken";

  const result = await service.searchDocs(request);

  expect(result.results.map(({ path }) => path)).toEqual(["pages/guides/data"]);
  expect(result.coverage).toMatchObject({
    partial: true,
    indexedDocuments: 1,
    failedDocuments: 2,
    failures: [
      { path: "app/guides/data", code: "SOURCE_ERROR" },
      { path: "app/guides/database", code: "PARSE_ERROR" },
    ],
  });
});

test("fails explicitly when every selected page or the catalog is unavailable", async () => {
  const { service, adapter } = setup();
  adapter.fetchDocument.mockRejectedValue(new Error("Unavailable"));

  await expect(service.searchDocs(request)).rejects.toMatchObject({
    code: "INDEX_UNAVAILABLE",
  });

  adapter.fetchCatalog.mockRejectedValue(new Error("Offline"));

  await expect(service.searchDocs(request)).rejects.toMatchObject({
    code: "SOURCE_ERROR",
  });
});

test("reports stale catalog and pages even if none of them match", async () => {
  const { service, adapter, catalog } = setup();
  const cache = {
    status: "stale",
    checkedAt: catalog.fetchedAt,
    persisted: true,
    warning: "Offline",
  };

  catalog.cache = cache;
  const original = adapter.fetchDocument.getMockImplementation();

  adapter.fetchDocument.mockImplementation(async (path) => ({
    ...(await original(path)),
    cache,
  }));
  const result = await service.searchDocs({
    ...request,
    query: "notfoundkeyword",
  });

  expect(result.results).toEqual([]);
  expect(result.coverage).toMatchObject({
    staleDocuments: 3,
    catalogCache: cache,
    partial: false,
  });
});

test("limits result count while reporting all matches", async () => {
  const { service } = setup();
  const result = await service.searchDocs({ ...request, limit: 1 });

  expect(result.results).toHaveLength(1);
  expect(result.totalMatches).toBe(2);
});

test.each([
  { query: " " },
  { query: "!!!" },
  { query: "the and of" },
  { query: "x".repeat(257) },
  { path_prefix: "../secret" },
  { path_prefix: "app/" },
  { library: "react" },
  { limit: 0 },
  { limit: 21 },
  { version: "14" },
])("rejects invalid input before loading the catalog: %j", async (invalid) => {
  const { service, adapter } = setup();

  await expect(
    service.searchDocs({ ...request, ...invalid }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

  expect(adapter.fetchCatalog).not.toHaveBeenCalled();
});

test("bounds page fetch concurrency to four and truncates failure details", async () => {
  const contents = Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [
      `app/page-${i}`,
      "# Guide\n\nRevalidation.",
    ]),
  );

  const { service, adapter } = setup(contents);
  const original = adapter.fetchDocument.getMockImplementation();

  let active = 0;
  let peak = 0;

  adapter.fetchDocument.mockImplementation(async (path) => {
    active += 1;
    peak = Math.max(peak, active);

    await new Promise((resolve) => setImmediate(resolve));

    active -= 1;

    if (path !== "app/page-0") {
      throw new Error("Unavailable");
    }
    return original(path);
  });

  const result = await service.searchDocs(request);

  expect(peak).toBe(4);
  expect(result.coverage).toMatchObject({
    failedDocuments: 25,
    failuresTruncated: true,
  });
  expect(result.coverage.failures).toHaveLength(20);
});

test("cancels active workers and queued requests, then recovers on the next call", async () => {
  const { service, adapter } = setup();
  const original = adapter.fetchDocument.getMockImplementation();
  const signals = [];

  adapter.fetchDocument.mockImplementation((_path, signal) => {
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });

  const first = new AbortController();
  const queued = new AbortController();
  const pending = service.searchDocs(request, first.signal);

  const firstAssertion = expect(pending).rejects.toThrow("Stop first");

  await vi.waitFor(() => expect(signals).toHaveLength(3));

  const waiting = service.searchDocs(request, queued.signal);
  const queuedAssertion = expect(waiting).rejects.toThrow("Stop queued");

  queued.abort(new Error("Stop queued"));
  await queuedAssertion;

  expect(signals.every((signal) => !signal.aborted)).toBe(true);

  first.abort(new Error("Stop first"));
  await firstAssertion;

  expect(signals.every((signal) => signal.aborted)).toBe(true);

  adapter.fetchDocument.mockImplementation(original);
  const result = await service.searchDocs(request);

  expect(result.coverage.indexedDocuments).toBe(3);
  expect(adapter.fetchCatalog).toHaveBeenCalledTimes(2);
});

import { expect, test, vi } from "vitest";
import { CodeExamplesService } from "../../../../dist/modules/code-examples/code-examples.service.js";
import { getCodeExamplesOutputSchema } from "../../../../dist/modules/code-examples/schemas/get-code-examples.schema.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";
import { createRegistry } from "../../libraries/tests/fixtures/library.fixture.mjs";

const request = { library: "nextjs", query: "revalidateTag" };
const markdown = [
  "# Data",
  "",
  "## Updating",
  "",
  "Update cached posts.",
  "",
  '```ts title="actions.ts"',
  "revalidateTag('posts')",
  "```",
  "",
  "```js",
  "unrelatedFunction()",
  "```",
  "",
  "## Storage",
  "",
  "~~~javascript",
  "revalidateTag('storage')",
  "~~~",
].join("\r\n");

function setup(
  contents = {
    "app/guides/data": markdown,
    "app/guides/database": "# Database\n\nRevalidateTag has no code here.",
    "pages/guide": "# Legacy\n\n    revalidateTag('legacy')\n",
  },
) {
  const catalog = {
    libraryId: "nextjs",
    sourceUrl: "https://nextjs.org/docs/llms.txt",
    fetchedAt: "2026-10-28T10:00:00.000Z",
    docVersion: "99.1.0",
    documents: Object.keys(contents).map((path) => ({
      path,
      title: path,
      sourceUrl: `https://nextjs.org/docs/${path}`,
    })),
  };

  const adapter = {
    libraryId: "nextjs",
    isValidPath: vi.fn(() => true),
    fetchCatalog: vi.fn(async () => catalog),
    fetchDocument: vi.fn(async (path) => ({
      libraryId: "nextjs",
      path,
      sourceUrl: `https://nextjs.org/docs/${path}`,
      fetchedAt: catalog.fetchedAt,
      format: "markdown",
      content: contents[path],
    })),
  };

  return {
    adapter,
    catalog,
    contents,
    service: new CodeExamplesService(
      createRegistry(adapter),
      new MarkdownDocumentParser(),
    ),
  };
}

test("extracts complete code with compact metadata and retrieval arguments", async () => {
  const { service, adapter } = setup();
  const result = await service.getCodeExamples(request);

  expect(getCodeExamplesOutputSchema.safeParse(result).success).toBe(true);
  expect(result).toMatchObject({
    libraryId: "nextjs",
    version: "current",
    totalMatches: 3,
    coverage: {
      scope: "root-catalog",
      docVersion: "99.1.0",
      indexedExamples: 4,
      indexedDocuments: 3,
      failedDocuments: 0,
      partial: false,
    },
  });

  const example = result.examples.find(({ language }) => language === "ts");

  expect(example).toEqual({
    sourceUrl: "https://nextjs.org/docs/app/guides/data",
    sectionTitle: "Updating",
    code: "revalidateTag('posts')",
    language: "ts",
    meta: 'title="actions.ts"',
    fetchedAt: "2026-10-28T10:00:00.000Z",
    getDocumentation: {
      library: "nextjs",
      path: "app/guides/data",
      section_id: "updating",
      expected_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });
  expect(result).not.toHaveProperty("query");
  expect(result).not.toHaveProperty("terms");
  expect(
    result.examples.find(({ language }) => language === undefined),
  ).toEqual({
    code: "revalidateTag('legacy')",
    sourceUrl: "https://nextjs.org/docs/pages/guide",
    sectionTitle: "Legacy",
    fetchedAt: "2026-10-28T10:00:00.000Z",
    getDocumentation: {
      library: "nextjs",
      path: "pages/guide",
      section_id: "legacy",
      expected_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });
  expect(
    result.examples.some(({ code }) => code.includes("unrelatedFunction")),
  ).toBe(false);
  expect(adapter.fetchCatalog).toHaveBeenCalledExactlyOnceWith(undefined, {
    refresh: false,
  });
});

test.each([
  [["TS"], ["ts"]],
  [["typescript"], ["ts"]],
  [[" js "], ["javascript"]],
  [
    ["ts", "JS"],
    ["javascript", "ts"],
  ],
  [["tsx"], []],
])(
  "filters fence languages and aliases before ranking: %j",
  async (languages, expected) => {
    const { service } = setup();
    const result = await service.getCodeExamples({
      ...request,
      filters: { languages },
    });

    expect(result.examples.map(({ language }) => language).sort()).toEqual(
      expected,
    );
    expect(result.totalMatches).toBe(expected.length);
  },
);

test("uses surrounding prose and headings to find code without the query in the block", async () => {
  const { service } = setup({
    "app/example":
      "# Guide\n\n## Revalidation\n\nUpdate cached posts.\n\n```ts\nrun()\n```",
  });
  const result = await service.getCodeExamples({
    ...request,
    query: "revalidation",
  });

  expect(result.examples[0].code).toBe("run()");
});

test.each([
  ["app/guides/data", ["app/guides/data"]],
  ["app/guides", ["app/guides/data", "app/guides/database"]],
  ["unknown", []],
])(
  "restricts downloads to the exact page or subtree: %s",
  async (path_prefix, expected) => {
    const { service, adapter } = setup();
    const result = await service.getCodeExamples({
      ...request,
      filters: { path_prefix },
    });

    expect(adapter.fetchDocument.mock.calls.map(([path]) => path)).toEqual(
      expected,
    );
    expect(result.coverage.selectedDocuments).toBe(expected.length);
  },
);

test("applies the limit to examples rather than candidate sections and searches beyond 20 sections", async () => {
  const contents = Object.fromEntries(
    Array.from({ length: 25 }, (_, i) => [
      `app/page-${i}`,
      `# Guide\n\n## Revalidation ${i}\n\nOnly prose.`,
    ]),
  );

  contents["app/last"] =
    "# Guide\n\n## Revalidation\n\n" +
    Array.from({ length: 7 }, (_, i) => `\`\`\`ts\nrun(${i})\n\`\`\``).join(
      "\n\n",
    );

  const { service } = setup(contents);
  const result = await service.getCodeExamples({
    ...request,
    query: "revalidation",
  });

  expect(result.examples).toHaveLength(5);
  expect(result.totalMatches).toBe(7);

  const limited = await service.getCodeExamples({
    ...request,
    query: "revalidation",
    limit: 1,
  });

  expect(limited.examples).toHaveLength(1);
  expect(limited.examples[0].code).toBe("run(0)");
  expect(limited.totalMatches).toBe(7);
});

test("returns an empty success for no matching code and ignores empty blocks and inline code", async () => {
  const { service } = setup({
    "app/example": "# Guide\n\n`revalidateTag`\n\n```ts\n\n```",
  });
  const result = await service.getCodeExamples(request);

  expect(result.examples).toEqual([]);
  expect(result.totalMatches).toBe(0);
});

test.each([
  { library: "react" },
  { query: " " },
  { query: "!!!" },
  { query: "the and" },
  { query: "x".repeat(257) },
  { limit: 0 },
  { limit: 21 },
  { limit: 1.5 },
  { filters: { path_prefix: "../secret" } },
  { filters: { path_prefix: "app/" } },
  { filters: { languages: [] } },
  { filters: { languages: [""] } },
  { filters: { language: "ts" } },
  { filters: null },
  { version: "" },
])("validates input before loading sources: %j", async (invalid) => {
  const { service, adapter } = setup();

  await expect(
    service.getCodeExamples({ ...request, ...invalid }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

  expect(adapter.fetchCatalog).not.toHaveBeenCalled();
});

test.each(["14", "99.1.0", "^16"])(
  "rejects unavailable version %s without silently serving current docs",
  async (version) => {
    const { service, adapter } = setup();

    await expect(
      service.getCodeExamples({ ...request, version }),
    ).rejects.toMatchObject({ code: "VERSION_UNAVAILABLE" });
    expect(adapter.fetchCatalog).not.toHaveBeenCalled();
  },
);

test("reports source and parser failures without returning obsolete examples", async () => {
  const { service, adapter, contents } = setup();

  await service.getCodeExamples(request);

  contents["app/guides/database"] = "---\ntitle: [invalid]\n---\n# Broken";

  const original = adapter.fetchDocument.getMockImplementation();

  adapter.fetchDocument.mockImplementation(async (path) => {
    if (path === "app/guides/data") {
      throw new Error("Offline");
    }

    return original(path);
  });

  const result = await service.getCodeExamples(request);

  expect(
    result.examples.map(({ getDocumentation }) => getDocumentation.path),
  ).toEqual(["pages/guide"]);
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

test("fails explicitly when no selected pages or the catalog can be loaded", async () => {
  const { service, adapter } = setup();

  adapter.fetchDocument.mockRejectedValue(new Error("Offline"));

  await expect(service.getCodeExamples(request)).rejects.toMatchObject({
    code: "INDEX_UNAVAILABLE",
  });

  adapter.fetchCatalog.mockRejectedValue(new Error("Offline"));

  await expect(service.getCodeExamples(request)).rejects.toMatchObject({
    code: "SOURCE_ERROR",
  });
});

test("forwards refresh and cancellation and preserves stale-source metadata", async () => {
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

  const controller = new AbortController();
  const result = await service.getCodeExamples(
    { ...request, refresh: true },
    controller.signal,
  );

  expect(adapter.fetchCatalog).toHaveBeenCalledWith(controller.signal, {
    refresh: true,
  });
  expect(adapter.fetchDocument).toHaveBeenCalledWith(
    "pages/guide",
    controller.signal,
    { refresh: true },
  );
  expect(result.examples[0].cache).toEqual(cache);
  expect(result.coverage).toMatchObject({
    staleDocuments: 3,
    catalogCache: cache,
  });

  const reason = new Error("Stop extraction");
  controller.abort(reason);

  adapter.fetchCatalog.mockClear();

  await expect(
    service.getCodeExamples(request, controller.signal),
  ).rejects.toBe(reason);

  expect(adapter.fetchCatalog).not.toHaveBeenCalled();
});

test("bounds concurrent downloads and truncates failure details", async () => {
  const { service, adapter } = setup(
    Object.fromEntries(
      Array.from({ length: 26 }, (_, i) => [
        `app/page-${i}`,
        "# Guide\n\n```ts\nrevalidateTag()\n```",
      ]),
    ),
  );
  const original = adapter.fetchDocument.getMockImplementation();

  let active = 0;
  let peak = 0;

  adapter.fetchDocument.mockImplementation(async (path) => {
    active += 1;
    peak = Math.max(peak, active);

    await new Promise((resolve) => setImmediate(resolve));

    active -= 1;

    if (path !== "app/page-0") {
      throw new Error("Offline");
    }
    return original(path);
  });

  const result = await service.getCodeExamples(request);

  expect(peak).toBe(4);
  expect(result.coverage).toMatchObject({
    failedDocuments: 25,
    failuresTruncated: true,
  });
  expect(result.coverage.failures).toHaveLength(20);
});

test("cancelling one request leaves a concurrent request and later calls unaffected", async () => {
  const { service, adapter } = setup();
  const controller = new AbortController();
  const original = adapter.fetchDocument.getMockImplementation();
  const signals = [];

  adapter.fetchDocument.mockImplementation((path, signal) => {
    if (signal !== controller.signal) {
      return original(path);
    }

    signals.push(signal);

    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });

  const pending = service.getCodeExamples(request, controller.signal);
  const assertion = expect(pending).rejects.toThrow("Stop first request");

  await vi.waitFor(() => expect(signals).toHaveLength(3));

  const concurrent = await service.getCodeExamples({
    ...request,
    filters: { languages: ["ts"] },
  });

  expect(concurrent.examples).toHaveLength(1);
  expect(signals.every((signal) => !signal.aborted)).toBe(true);

  controller.abort(new Error("Stop first request"));

  await assertion;

  const recovered = await service.getCodeExamples(request);
  expect(recovered.totalMatches).toBe(3);
});

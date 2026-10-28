import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { FileCacheService } from "../../../../dist/modules/cache/file-cache.service.js";
import { CodeExamplesService } from "../../../../dist/modules/code-examples/code-examples.service.js";
import { DocumentationService } from "../../../../dist/modules/documentation/documentation.service.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";
import { GetCodeExamplesTool } from "../../../../dist/modules/mcp/tools/get-code-examples.tool.js";
import { GetDocumentationTool } from "../../../../dist/modules/mcp/tools/get-documentation.tool.js";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";
import { CachedMarkdownService } from "../../../../dist/modules/sources/services/cached-markdown.service.js";
import {
  createRegistry,
  nextjsSourceOptions,
  nextjsCacheScope,
} from "../../libraries/tests/fixtures/library.fixture.mjs";

const catalogUrl = "https://nextjs.org/docs/llms.txt";
const path = "app/guides/caching";

const markdown =
  "# Caching\n\n## Updating\n\nUse tags to update posts.\n\n```ts title=actions.ts\nrevalidateTag('posts')\n```\n\n```js\nrevalidateTag('other')\n```";

const catalog = `# Next.js\n\n@doc-version: 99.1.0\n\n- [Caching](https://nextjs.org/docs/${path})`;
const request = { library: "nextjs", query: "revalidateTag" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function cacheOptions(ttlMs = 3_600_000) {
  const directory = await mkdtemp(
    join(tmpdir(), "documentation-mcp-examples-"),
  );

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory, ttlMs, enabled: true };
}

async function connect(options, service) {
  const adapter = new NextjsAdapter(
    new CachedMarkdownService(
      new FileCacheService(
        options ?? {
          directory: process.cwd(),
          enabled: false,
          ttlMs: 0,
        },
      ),
      nextjsCacheScope,
    ),
    nextjsSourceOptions,
  );

  const parser = new MarkdownDocumentParser();
  const server = new McpServer({ name: "examples-test", version: "1.0.0" });

  new GetCodeExamplesTool(
    service ?? new CodeExamplesService(createRegistry(adapter), parser),
  ).register(server);
  new GetDocumentationTool(
    new DocumentationService(createRegistry(adapter), parser),
  ).register(server);

  const client = new Client({ name: "test-client", version: "1.0.0" });

  onTestFinished(async () => {
    await client.close();
    await server.close();
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

function mockSources() {
  const fetchMock = vi.fn(
    async (url) =>
      new Response(url === catalogUrl ? catalog : markdown, {
        headers: { "Content-Type": "text/markdown", ETag: '"v1"' },
      }),
  );

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

test("discovers schemas, extracts matching examples and retrieves their exact source section", async () => {
  const fetchMock = mockSources();

  const client = await connect(await cacheOptions());
  const { tools } = await client.listTools();
  const tool = tools.find(({ name }) => name === "get_code_examples");

  expect(tool).toMatchObject({
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      required: ["library", "query"],
      additionalProperties: false,
      properties: {
        version: { default: "current" },
        filters: { additionalProperties: false },
      },
    },
    outputSchema: { properties: { examples: { type: "array" } } },
  });

  const result = await client.callTool({
    name: "get_code_examples",
    arguments: {
      ...request,
      version: "current",
      filters: { languages: ["typescript"], path_prefix: "app/guides" },
      limit: 1,
    },
  });

  expect(result.isError).not.toBe(true);
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  expect(result.structuredContent).toMatchObject({
    version: "current",
    totalMatches: 1,
    coverage: {
      indexedDocuments: 1,
      indexedExamples: 1,
      docVersion: "99.1.0",
      partial: false,
    },
  });

  const example = result.structuredContent.examples[0];

  expect(example).toEqual({
    code: "revalidateTag('posts')",
    language: "ts",
    meta: "title=actions.ts",
    sourceUrl: `https://nextjs.org/docs/${path}`,
    sectionTitle: "Updating",
    fetchedAt: expect.any(String),
    cache: { status: "miss", checkedAt: expect.any(String), persisted: true },
    getDocumentation: {
      library: "nextjs",
      path,
      section_id: "updating",
      expected_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });

  expect(
    Object.keys(tool.outputSchema.properties.examples.items.properties).sort(),
  ).toEqual(Object.keys(example).sort());
  expect(result.structuredContent).not.toHaveProperty("terms");
  expect(result.structuredContent).not.toHaveProperty("query");

  const source = await client.callTool({
    name: "get_documentation",
    arguments: example.getDocumentation,
  });

  expect(source.isError).not.toBe(true);
  expect(source.structuredContent.content).toContain(example.code);
  expect(source.structuredContent.contentHash).toBe(
    example.getDocumentation.expected_hash,
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("reports progress when requested by the MCP client", async () => {
  mockSources();

  const client = await connect();
  const progress = [];
  const result = await client.callTool(
    { name: "get_code_examples", arguments: request },
    {
      onprogress: (update) => progress.push(update),
      resetTimeoutOnProgress: true,
    },
  );

  expect(result.isError).not.toBe(true);
  expect(progress.map(({ progress, total }) => [progress, total])).toEqual([
    [0, 1],
    [1, 1],
  ]);
});

test.each([
  { query: " " },
  { filters: { languages: [] } },
  { filters: { path_prefix: "../secret" } },
  { filters: { language: "ts" } },
  { limit: 0 },
  { version: "14" },
])(
  "rejects invalid or unavailable requests before HTTP: %j",
  async (invalid) => {
    const fetchMock = mockSources();
    const client = await connect();
    const result = await client.callTool({
      name: "get_code_examples",
      arguments: { ...request, ...invalid },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test("returns an empty success when the query has no code examples", async () => {
  mockSources();

  const client = await connect();
  const result = await client.callTool({
    name: "get_code_examples",
    arguments: { ...request, query: "missingkeyword" },
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    totalMatches: 0,
    examples: [],
  });
});

test("reuses disk sources across servers and revalidates them on refresh", async () => {
  const fetchMock = mockSources();

  const options = await cacheOptions();
  const client = await connect(options);

  await client.callTool({ name: "get_code_examples", arguments: request });

  const second = await connect(options);
  const cached = await second.callTool({
    name: "get_code_examples",
    arguments: request,
  });

  expect(cached.structuredContent.examples[0].cache.status).toBe("hit");
  expect(fetchMock).toHaveBeenCalledTimes(2);

  fetchMock.mockImplementation(async () => new Response(null, { status: 304 }));

  const refreshed = await client.callTool({
    name: "get_code_examples",
    arguments: { ...request, refresh: true },
  });

  expect(refreshed.structuredContent.examples[0].cache.status).toBe(
    "revalidated",
  );
  expect(refreshed.structuredContent.coverage.catalogCache.status).toBe(
    "revalidated",
  );
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(
    fetchMock.mock.calls
      .slice(2)
      .every(([, init]) => init.headers.get("If-None-Match") === '"v1"'),
  ).toBe(true);
});

test("reports stale examples offline and detects a source change during retrieval", async () => {
  const fetchMock = mockSources();

  const client = await connect(await cacheOptions(0));
  const first = await client.callTool({
    name: "get_code_examples",
    arguments: request,
  });

  fetchMock.mockRejectedValue(new TypeError("Offline"));

  const stale = await client.callTool({
    name: "get_code_examples",
    arguments: request,
  });

  expect(stale.isError).not.toBe(true);
  expect(stale.structuredContent.coverage).toMatchObject({
    staleDocuments: 1,
    catalogCache: { status: "stale" },
  });
  expect(stale.structuredContent.examples[0].cache).toMatchObject({
    status: "stale",
    warning: expect.any(String),
  });

  fetchMock.mockImplementation(
    async () =>
      new Response(`${markdown}\nChanged.`, {
        headers: { "Content-Type": "text/markdown" },
      }),
  );

  const outdated = await client.callTool({
    name: "get_documentation",
    arguments: first.structuredContent.examples[0].getDocumentation,
  });

  expect(outdated.isError).toBe(true);
  expect(JSON.parse(outdated.content[0].text).code).toBe("DOCUMENT_CHANGED");
});

test("maps source failures to failed tool results", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Unavailable", { status: 503 })),
  );

  const client = await connect();
  const result = await client.callTool({
    name: "get_code_examples",
    arguments: request,
  });

  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text).code).toBe("SOURCE_ERROR");
});

test("logs unexpected failures without exposing internal details", async () => {
  const error = new Error("Private parser failure");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  const client = await connect(undefined, {
    getCodeExamples: vi.fn().mockRejectedValue(error),
  });
  const result = await client.callTool({
    name: "get_code_examples",
    arguments: request,
  });

  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text)).toEqual({
    code: "INTERNAL_ERROR",
    message: "Could not extract code examples.",
  });
  expect(log).toHaveBeenCalledExactlyOnceWith("[get_code_examples]", error);
});

test("propagates MCP cancellation to documentation downloads", async () => {
  const fetchMock = mockSources();
  const original = fetchMock.getMockImplementation();

  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });

  fetchMock.mockImplementation((url, init) => {
    if (url === catalogUrl) {
      return original(url, init);
    }

    markStarted(init.signal);

    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), {
        once: true,
      });
    });
  });

  const client = await connect();

  const controller = new AbortController();
  const pending = client.callTool(
    { name: "get_code_examples", arguments: request },
    { signal: controller.signal },
  );
  const assertion = expect(pending).rejects.toThrow();
  const sourceSignal = await started;

  controller.abort(new Error("Stop examples request"));

  await assertion;
  await vi.waitFor(() => expect(sourceSignal.aborted).toBe(true));
});

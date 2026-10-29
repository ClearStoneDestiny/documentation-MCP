import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, afterEach, expect, onTestFinished, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { FileCacheService } from "../../../../dist/modules/cache/file-cache.service.js";
import { CachedMarkdownService } from "../../../../dist/modules/sources/services/cached-markdown.service.js";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";
import { DocumentationService } from "../../../../dist/modules/documentation/documentation.service.js";
import { SearchService } from "../../../../dist/modules/search/search.service.js";
import { SearchDocsTool } from "../../../../dist/modules/mcp/tools/search-docs.tool.js";
import { GetDocumentationTool } from "../../../../dist/modules/mcp/tools/get-documentation.tool.js";
import {
  createRegistry,
  nextjsSourceOptions,
  nextjsCacheScope,
} from "../../libraries/tests/fixtures/library.fixture.mjs";

describe("SearchDocsTool", () => {
  const catalogUrl = "https://nextjs.org/docs/llms.txt";
  const path = "app/guides/caching";
  const pageUrl = `https://nextjs.org/docs/${path}.md`;

  const markdown =
    "# Caching\n\n## Revalidation\n\nUse revalidateTag to update cached data.\n\n```ts\nrevalidateTag('posts')\n```\n\n## Storage\n\nSave entries.";

  const catalog = `# Next.js\n\n@doc-version: 99.1.0\n\n- [Caching](https://nextjs.org/docs/${path})\n- [Other](https://nextjs.org/docs/app/guides/other)\n- [Pages index](https://nextjs.org/docs/pages/llms.txt)`;
  const request = { library: "nextjs", query: "revalidateTag" };

  afterEach(() => vi.unstubAllGlobals());

  async function options(ttlMs = 3_600_000) {
    const directory = await mkdtemp(
      join(tmpdir(), "documentation-mcp-search-"),
    );

    onTestFinished(() => rm(directory, { recursive: true, force: true }));

    return { directory, ttlMs, enabled: true };
  }

  async function connect(cacheOptions) {
    const adapter = new NextjsAdapter(
      new CachedMarkdownService(
        new FileCacheService(cacheOptions),
        nextjsCacheScope,
      ),
      nextjsSourceOptions,
    );
    const registry = createRegistry(adapter);
    const server = new McpServer({ name: "search-test", version: "1.0.0" });

    new SearchDocsTool(new SearchService(registry)).register(server);
    new GetDocumentationTool(new DocumentationService(registry)).register(
      server,
    );

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
        new Response(
          url === catalogUrl
            ? catalog
            : url === pageUrl
              ? markdown
              : "# Other\n\nUnrelated content.",
          { headers: { "Content-Type": "text/markdown", ETag: '"v1"' } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  describe("discovery, search, and progress", () => {
    test("discovers schemas and searches then retrieves the exact section through MCP", async () => {
      const fetchMock = mockSources();

      const client = await connect(await options());
      const { tools } = await client.listTools();
      const tool = tools.find(({ name }) => name === "search_docs");

      expect(tool).toMatchObject({
        annotations: { readOnlyHint: true, openWorldHint: true },
      });
      expect(tool.inputSchema.required).toEqual(["library", "query"]);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema.properties.results.type).toBe("array");

      const result = await client.callTool({
        name: "search_docs",
        arguments: request,
      });

      expect(result.isError).not.toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual(
        result.structuredContent,
      );

      const search = result.structuredContent;

      expect(search.coverage).toMatchObject({
        scope: "root-catalog",
        catalogDocuments: 2,
        indexedDocuments: 2,
        partial: false,
      });
      expect(search.results[0]).toMatchObject({
        path,
        sectionId: "revalidation",
        cache: { status: "miss" },
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const retrieved = await client.callTool({
        name: "get_documentation",
        arguments: search.results[0].getDocumentation,
      });

      expect(retrieved.isError).not.toBe(true);
      expect(retrieved.structuredContent).toMatchObject({
        selectedSectionId: "revalidation",
        contentHash: search.results[0].contentHash,
        content: markdown.slice(
          markdown.indexOf("## Revalidation"),
          markdown.indexOf("## Storage"),
        ),
        cache: { status: "hit" },
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test("rebuilds the process index from disk in a new server without HTTP", async () => {
      const fetchMock = mockSources();
      const cacheOptions = await options();

      const first = await connect(cacheOptions);
      await first.callTool({ name: "search_docs", arguments: request });

      const second = await connect(cacheOptions);
      const result = await second.callTool({
        name: "search_docs",
        arguments: request,
      });

      expect(result.structuredContent.results[0].cache.status).toBe("hit");
      expect(result.structuredContent.coverage.catalogCache.status).toBe("hit");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test("reports indexing progress when requested by the MCP client", async () => {
      mockSources();

      const client = await connect(await options());
      const progress = [];
      const result = await client.callTool(
        { name: "search_docs", arguments: request },
        {
          onprogress: (update) => progress.push(update),
          resetTimeoutOnProgress: true,
        },
      );

      expect(result.isError).not.toBe(true);
      expect(progress.map(({ progress, total }) => [progress, total])).toEqual([
        [0, 2],
        [1, 2],
        [2, 2],
      ]);
    });
  });

  describe("refresh and source availability", () => {
    test("refresh updates sections and detects changes between search and retrieval", async () => {
      const fetchMock = mockSources();

      const client = await connect(await options());
      const first = (
        await client.callTool({ name: "search_docs", arguments: request })
      ).structuredContent;

      fetchMock.mockImplementation(async (url) =>
        url === pageUrl
          ? new Response("# Caching\n\n## Replacement\n\nNewkeyword.", {
              headers: { "Content-Type": "text/markdown" },
            })
          : new Response(null, { status: 304 }),
      );

      const refreshed = await client.callTool({
        name: "search_docs",
        arguments: { ...request, query: "newkeyword", refresh: true },
      });

      expect(refreshed.isError).not.toBe(true);
      expect(refreshed.structuredContent.results[0]).toMatchObject({
        sectionId: "replacement",
        cache: { status: "updated" },
      });
      expect(refreshed.structuredContent.results[0].contentHash).not.toBe(
        first.results[0].contentHash,
      );
      expect(
        fetchMock.mock.calls
          .slice(3)
          .every(([, init]) => init.headers.get("If-None-Match") === '"v1"'),
      ).toBe(true);

      const outdated = await client.callTool({
        name: "get_documentation",
        arguments: first.results[0].getDocumentation,
      });

      expect(outdated.isError).toBe(true);
      expect(JSON.parse(outdated.content[0].text).code).toBe(
        "DOCUMENT_CHANGED",
      );
    });

    test("reports stale offline results after TTL and partial failures after a permanent HTTP error", async () => {
      const fetchMock = mockSources();

      const client = await connect(await options(0));
      await client.callTool({ name: "search_docs", arguments: request });

      fetchMock.mockRejectedValue(new TypeError("Offline"));

      const offline = await client.callTool({
        name: "search_docs",
        arguments: request,
      });

      expect(offline.isError).not.toBe(true);
      expect(offline.structuredContent).toMatchObject({
        results: [
          expect.objectContaining({
            cache: expect.objectContaining({ status: "stale" }),
          }),
        ],
        coverage: {
          staleDocuments: 2,
          catalogCache: { status: "stale" },
          partial: false,
        },
      });

      fetchMock.mockImplementation(async (url) =>
        url === pageUrl
          ? new Response("Gone", { status: 404 })
          : new Response(null, { status: 304 }),
      );

      const removed = await client.callTool({
        name: "search_docs",
        arguments: request,
      });

      expect(removed.isError).not.toBe(true);
      expect(removed.structuredContent).toMatchObject({
        results: [],
        coverage: {
          indexedDocuments: 1,
          failedDocuments: 1,
          partial: true,
          failures: [{ path, code: "SOURCE_ERROR" }],
        },
      });
    });
  });

  describe("validation, failures, and cancellation", () => {
    test.each([
      { query: " " },
      { version: "14" },
      { path_prefix: "../secret" },
    ])("validates search input before HTTP: %j", async (invalid) => {
      const fetchMock = mockSources();

      const client = await connect(await options());
      const result = await client.callTool({
        name: "search_docs",
        arguments: { ...request, ...invalid },
      });

      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("maps an unavailable catalog to an operational tool error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("Error", { status: 503 })),
      );

      const client = await connect(await options());
      const result = await client.callTool({
        name: "search_docs",
        arguments: request,
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.parse(result.content[0].text).code).toBe("SOURCE_ERROR");
    });

    test("propagates MCP cancellation to indexing requests", async () => {
      const fetchMock = mockSources();

      const signals = [];
      const original = fetchMock.getMockImplementation();

      fetchMock.mockImplementation((url, init) => {
        if (url === catalogUrl) {
          return original(url, init);
        }

        signals.push(init.signal);

        return new Promise((_resolve, reject) =>
          init.signal.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            {
              once: true,
            },
          ),
        );
      });

      const client = await connect(await options());

      const controller = new AbortController();
      const pending = client.callTool(
        { name: "search_docs", arguments: request },
        { signal: controller.signal },
      );
      const assertion = expect(pending).rejects.toThrow();

      await vi.waitFor(() => expect(signals).toHaveLength(2));

      controller.abort(new Error("Stop search"));

      await assertion;
      await vi.waitFor(() =>
        expect(signals.every((signal) => signal.aborted)).toBe(true),
      );
    });
  });
});

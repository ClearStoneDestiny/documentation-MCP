import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { FileCacheService } from "../../../../dist/modules/cache/file-cache.service.js";
import { VersionService } from "../../../../dist/modules/libraries/version.service.js";
import { ListVersionsTool } from "../../../../dist/modules/mcp/tools/list-versions.tool.js";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";
import { CachedMarkdownService } from "../../../../dist/modules/sources/services/cached-markdown.service.js";

const catalogUrl = "https://nextjs.org/docs/llms.txt";
const catalog =
  "# Next.js\n\n@doc-version: 99.1.0\n\n- [Caching](https://nextjs.org/docs/app/guides/caching)";
const request = { library: "nextjs" };

afterEach(() => vi.unstubAllGlobals());

async function connect(
  cacheOptions = { directory: process.cwd(), ttlMs: 0, enabled: false },
) {
  const adapter = new NextjsAdapter(
    new CachedMarkdownService(new FileCacheService(cacheOptions)),
  );
  const server = new McpServer({ name: "versions-test", version: "1.0.0" });

  new ListVersionsTool(new VersionService(adapter)).register(server);

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

function mockCatalog(content = catalog) {
  const fetchMock = vi.fn(
    async () =>
      new Response(content, {
        headers: { "Content-Type": "text/markdown", ETag: '"v1"' },
      }),
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function persistentCache(ttlMs = 3_600_000) {
  const directory = await mkdtemp(
    join(tmpdir(), "documentation-mcp-versions-"),
  );

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory, ttlMs, enabled: true };
}

test("discovers portable nullable schemas and returns matching structured and text results through MCP", async () => {
  const fetchMock = mockCatalog();

  const client = await connect();
  const { tools } = await client.listTools();
  const tool = tools.find(({ name }) => name === "list_versions");

  expect(tool).toMatchObject({
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  });
  expect(tool.inputSchema.required).toEqual(["library"]);
  expect(tool.inputSchema.additionalProperties).toBe(false);

  const item = tool.outputSchema.properties.documentationSets.items;

  for (const field of ["declaredVersion", "versionRange"]) {
    expect(item.properties[field]).toMatchObject({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(item.properties[field].type).toBeUndefined();
    expect(item.required).toContain(field);
  }

  const result = await client.callTool({
    name: "list_versions",
    arguments: request,
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({
    library: "nextjs",
    documentationSets: [
      {
        id: "current",
        label: "Current Next.js documentation",
        channel: "current",
        declaredVersion: "99.1.0",
        versionRange: null,
        sourceUrl: "https://nextjs.org/docs/",
      },
    ],
    catalog: {
      sourceUrl: catalogUrl,
      fetchedAt: expect.any(String),
      cache: {
        status: "disabled",
        checkedAt: expect.any(String),
        persisted: false,
      },
    },
  });
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(catalogUrl);
});

test("returns an explicit null when the catalog does not declare a version", async () => {
  mockCatalog(catalog.replace("@doc-version: 99.1.0", ""));
  
  const client = await connect();
  const result = await client.callTool({
    name: "list_versions",
    arguments: request,
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent.documentationSets[0]).toMatchObject({
    declaredVersion: null,
    versionRange: null,
  });
});

test.each([
  {},
  { library: "react" },
  { ...request, version: "14" },
  { ...request, refresh: "true" },
])("rejects invalid tool input before HTTP: %j", async (input) => {
  const fetchMock = mockCatalog();

  const client = await connect();
  const result = await client.callTool({
    name: "list_versions",
    arguments: input,
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  ["HTTP failure", () => new Response("Unavailable", { status: 503 })],
  [
    "invalid catalog",
    () =>
      new Response("# No documentation entries", {
        headers: { "Content-Type": "text/markdown" },
      }),
  ],
])("returns a failed tool result for %s", async (_name, response) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );

  const client = await connect();
  const result = await client.callTool({
    name: "list_versions",
    arguments: request,
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    code: "SOURCE_ERROR",
  });
});

test("reuses the catalog across MCP clients and conditionally revalidates on refresh", async () => {
  const fetchMock = mockCatalog();

  const options = await persistentCache();

  const client = await connect(options);
  const first = (
    await client.callTool({ name: "list_versions", arguments: request })
  ).structuredContent;

  const secondClient = await connect(options);
  const second = (
    await secondClient.callTool({ name: "list_versions", arguments: request })
  ).structuredContent;

  expect(first.catalog.cache).toMatchObject({
    status: "miss",
    persisted: true,
  });
  expect(second.catalog.cache.status).toBe("hit");
  expect(second.documentationSets).toEqual(first.documentationSets);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
  
  const refreshed = (
    await client.callTool({
      name: "list_versions",
      arguments: { ...request, refresh: true },
    })
  ).structuredContent;

  expect(refreshed.catalog.cache.status).toBe("revalidated");
  expect(refreshed.catalog.fetchedAt).toBe(first.catalog.fetchedAt);
  expect(refreshed.documentationSets).toEqual(first.documentationSets);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].headers.get("If-None-Match")).toBe('"v1"');
});

test("refresh updates the declared version and saves the new catalog", async () => {
  const fetchMock = mockCatalog();
  const client = await connect(await persistentCache());
  
  await client.callTool({ name: "list_versions", arguments: request });
  
  fetchMock.mockImplementation(
    async () =>
      new Response(catalog.replace("99.1.0", "99.2.0"), {
        headers: { "Content-Type": "text/markdown", ETag: '"v2"' },
      }),
  );

  const refreshed = (
    await client.callTool({
      name: "list_versions",
      arguments: { ...request, refresh: true },
    })
  ).structuredContent;
 
  expect(refreshed.documentationSets[0].declaredVersion).toBe("99.2.0");
  expect(refreshed.catalog.cache.status).toBe("updated");

  const saved = (
    await client.callTool({ name: "list_versions", arguments: request })
  ).structuredContent;
  
  expect(saved.documentationSets).toEqual(refreshed.documentationSets);
  expect(saved.catalog.cache.status).toBe("hit");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("returns the saved catalog with a stale warning when the source is offline", async () => {
  const fetchMock = mockCatalog();
 
  const client = await connect(await persistentCache(0));
  const first = (
    await client.callTool({ name: "list_versions", arguments: request })
  ).structuredContent;
  fetchMock.mockRejectedValue(new TypeError("Offline"));

  const result = await client.callTool({
    name: "list_versions",
    arguments: request,
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent.documentationSets).toEqual(
    first.documentationSets,
  );
  expect(result.structuredContent.catalog).toMatchObject({
    fetchedAt: first.catalog.fetchedAt,
    cache: {
      status: "stale",
      checkedAt: first.catalog.cache.checkedAt,
      warning: expect.any(String),
    },
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("propagates MCP cancellation to the catalog request", async () => {
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, { signal }) => {
      markStarted(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    }),
  );
 
  const client = await connect();
  const controller = new AbortController();
  const pending = client.callTool(
    { name: "list_versions", arguments: request },
    { signal: controller.signal },
  );
  const assertion = expect(pending).rejects.toThrow();
  const sourceSignal = await started;
  
  controller.abort(new Error("Stop listing versions"));

  await assertion;
  await vi.waitFor(() => expect(sourceSignal.aborted).toBe(true));
});

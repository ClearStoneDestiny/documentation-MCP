import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { DocumentationService } from "../../../../dist/modules/documentation/documentation.service.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";
import { GetDocumentationTool } from "../../../../dist/modules/mcp/tools/get-documentation.tool.js";
import { FileCacheService } from "../../../../dist/modules/cache/file-cache.service.js";
import { CachedMarkdownService } from "../../../../dist/modules/sources/services/cached-markdown.service.js";

const fixture = readFileSync(
  new URL("../../documentation/tests/fixtures/document.md", import.meta.url),
  "utf8",
);
const request = { library: "nextjs", path: "app/guides/example" };

afterEach(() => vi.unstubAllGlobals());

async function connect(
  cacheOptions = { directory: process.cwd(), ttlMs: 0, enabled: false },
) {
  const store = new FileCacheService(cacheOptions);
  const service = new DocumentationService(
    new NextjsAdapter(new CachedMarkdownService(store)),
    new MarkdownDocumentParser(),
  );
  const server = new McpServer({
    name: "documentation-test",
    version: "1.0.0",
  });

  new GetDocumentationTool(service).register(server);

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

function mockMarkdown(content = fixture) {
  const fetchMock = vi.fn(
    async () =>
      new Response(content, { headers: { "Content-Type": "text/markdown" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("serves structured documentation and matching text through the MCP SDK", async (context) => {
  const fetchMock = mockMarkdown();
  const client = await connect();
  const { tools } = await client.listTools();

  expect(tools[0]).toMatchObject({
    name: "get_documentation",
    annotations: { readOnlyHint: true, openWorldHint: true },
  });
  expect(tools[0].outputSchema).toBeDefined();

  const schema = tools[0].outputSchema;

  expect(schema.properties.selectedSectionId).toMatchObject({
    anyOf: [{ type: "string" }, { type: "null" }],
  });
  expect(schema.properties.selectedSectionId.type).toBeUndefined();

  expect(schema.required).toContain("selectedSectionId");
  const pagination = schema.properties.pagination;

  expect(pagination.properties.nextOffset).toMatchObject({
    anyOf: [{ type: "integer" }, { type: "null" }],
  });
  expect(pagination.properties.nextOffset.type).toBeUndefined();
  expect(pagination.required).toContain("nextOffset");

  const result = await client.callTool({
    name: "get_documentation",
    arguments: request,
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    title: "Example Guide",
    content: fixture,
    channel: "current",
    selectedSectionId: null,
    pagination: { nextOffset: null },
  });
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("supports section selection and continuation through real tools/call messages", async (context) => {
  mockMarkdown();

  const client = await connect();
  const args = {
    ...request,
    section_id: "setup-cache-with-links",
    max_chars: 256,
  };

  const first = (
    await client.callTool({ name: "get_documentation", arguments: args })
  ).structuredContent;
  const second = (
    await client.callTool({
      name: "get_documentation",
      arguments: {
        ...args,
        offset: first.pagination.nextOffset,
        expected_hash: first.contentHash,
      },
    })
  ).structuredContent;

  expect(first.pagination.truncated).toBe(true);
  expect(first.content + second.content).toBe(
    fixture.slice(fixture.indexOf("## Setup"), fixture.indexOf("## Usage")),
  );
});

test("returns isError for a missing section without presenting an empty success", async (context) => {
  mockMarkdown();

  const client = await connect();
  const result = await client.callTool({
    name: "get_documentation",
    arguments: { ...request, section_id: "missing" },
  });

  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    code: "SECTION_NOT_FOUND",
  });
});

test.each([{ path: "../secret" }, { version: "14" }, { offset: 1 }])(
  "validates tool input before making HTTP requests: %j",
  async (invalid) => {
    const fetchMock = mockMarkdown();

    const client = await connect();
    const result = await client.callTool({
      name: "get_documentation",
      arguments: { ...request, ...invalid },
    });

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test("returns source errors as failed tool results", async (context) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Unavailable", { status: 503 })),
  );

  const client = await connect();
  const result = await client.callTool({
    name: "get_documentation",
    arguments: request,
  });

  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    code: "SOURCE_ERROR",
  });
});

test("propagates MCP cancellation to the source request", async () => {
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
    { name: "get_documentation", arguments: request },
    { signal: controller.signal },
  );

  const assertion = expect(pending).rejects.toThrow();
  const sourceSignal = await started;
  controller.abort(new Error("Stop documentation request"));

  await assertion;
  await vi.waitFor(() => expect(sourceSignal.aborted).toBe(true));
});

async function persistentCache(ttlMs = 3_600_000) {
  const directory = await mkdtemp(
    join(tmpdir(), "documentation-mcp-tool-cache-"),
  );
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return { directory, ttlMs, enabled: true };
}

test("reuses disk content across MCP clients and revalidates on refresh", async () => {
  const options = await persistentCache();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(fixture, {
        headers: { "Content-Type": "text/markdown", ETag: '"v1"' },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 304 }));

  vi.stubGlobal("fetch", fetchMock);

  const client = await connect(options);
  const first = (
    await client.callTool({ name: "get_documentation", arguments: request })
  ).structuredContent;

  const secondClient = await connect(options);
  const second = (
    await secondClient.callTool({
      name: "get_documentation",
      arguments: request,
    })
  ).structuredContent;

  expect(first.cache).toMatchObject({ status: "miss", persisted: true });
  expect(second.cache.status).toBe("hit");
  expect(second.contentHash).toBe(first.contentHash);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const refreshed = (
    await client.callTool({
      name: "get_documentation",
      arguments: { ...request, refresh: true },
    })
  ).structuredContent;
  expect(refreshed.cache.status).toBe("revalidated");
  expect(refreshed.fetchedAt).toBe(first.fetchedAt);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("reports changed content during a forced refresh and serves the updated saved page afterwards", async () => {
  const fetchMock = mockMarkdown();
  const client = await connect(await persistentCache());

  const first = (
    await client.callTool({ name: "get_documentation", arguments: request })
  ).structuredContent;
  fetchMock.mockImplementation(
    async () =>
      new Response(`${fixture}\nUpdated.`, {
        headers: { "Content-Type": "text/markdown" },
      }),
  );

  const mismatch = await client.callTool({
    name: "get_documentation",
    arguments: { ...request, refresh: true, expected_hash: first.contentHash },
  });

  expect(mismatch.isError).toBe(true);
  expect(JSON.parse(mismatch.content[0].text).code).toBe("DOCUMENT_CHANGED");

  const current = (
    await client.callTool({ name: "get_documentation", arguments: request })
  ).structuredContent;

  expect(current.content).toContain("Updated.");
  expect(current.cache.status).toBe("hit");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("marks the response stale when the source is temporarily offline", async () => {
  const fetchMock = mockMarkdown();
  const client = await connect(await persistentCache(0));

  const first = (
    await client.callTool({ name: "get_documentation", arguments: request })
  ).structuredContent;
  fetchMock.mockRejectedValue(new TypeError("Offline"));

  const response = await client.callTool({
    name: "get_documentation",
    arguments: request,
  });

  expect(response.isError).not.toBe(true);
  expect(response.structuredContent.contentHash).toBe(first.contentHash);
  expect(response.structuredContent.cache).toMatchObject({
    status: "stale",
    checkedAt: first.cache.checkedAt,
    warning: expect.any(String),
  });
});

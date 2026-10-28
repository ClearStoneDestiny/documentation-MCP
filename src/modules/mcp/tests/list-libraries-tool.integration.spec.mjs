import {
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { FileCacheService } from "../../../../dist/modules/cache/file-cache.service.js";
import { DocumentationError } from "../../../../dist/modules/documentation/errors/documentation.error.js";
import { LibraryService } from "../../../../dist/modules/libraries/library.service.js";
import { ListLibrariesTool } from "../../../../dist/modules/mcp/tools/list-libraries.tool.js";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";
import { CachedMarkdownService } from "../../../../dist/modules/sources/services/cached-markdown.service.js";
import {
  createRegistry,
  nextjsSourceOptions,
} from "../../libraries/tests/fixtures/library.fixture.mjs";

const nextjsLibrary = {
  id: "nextjs",
  name: "Next.js",
  documentationUrl: "https://nextjs.org/docs/",
  capabilities: {
    tools: [
      "get_documentation",
      "search_docs",
      "list_versions",
      "get_code_examples",
    ],
    historicalDocumentation: false,
  },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("list_libraries must not make HTTP requests");
    }),
  );
});

afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

async function connect(service) {
  const adapter = new NextjsAdapter(
    new CachedMarkdownService(
      new FileCacheService({
        directory: process.cwd(),
        ttlMs: 0,
        enabled: false,
      }),
    ),
    nextjsSourceOptions,
  );
  const server = new McpServer({ name: "libraries-test", version: "1.0.0" });

  new ListLibrariesTool(
    service ?? new LibraryService(createRegistry(adapter)),
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

test("discovers schemas and returns matching structured and text library metadata through MCP", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const tool = tools.find(({ name }) => name === "list_libraries");

  expect(tool).toMatchObject({
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { filter: { type: "string", minLength: 1, maxLength: 100 } },
    },
    outputSchema: {
      type: "object",
      required: ["libraries"],
      properties: { libraries: { type: "array" } },
    },
  });
  expect(tool.inputSchema.required ?? []).toEqual([]);

  const result = await client.callTool({
    name: "list_libraries",
    arguments: {},
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({ libraries: [nextjsLibrary] });
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
});

test("accepts omitted arguments to list all libraries", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "list_libraries" });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({ libraries: [nextjsLibrary] });
});

test.each(["NeXtJ", "  XT.JS\t"])(
  "filters identifiers and display names through tools/call: %j",
  async (filter) => {
    const client = await connect();
    const result = await client.callTool({
      name: "list_libraries",
      arguments: { filter },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ libraries: [nextjsLibrary] });
  },
);

test("returns a successful empty result for an unmatched filter", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "list_libraries",
    arguments: { filter: "react" },
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({ libraries: [] });
  expect(JSON.parse(result.content[0].text)).toEqual({ libraries: [] });
});

test.each([
  { filter: "" },
  { filter: " \t\n" },
  { filter: "x".repeat(101) },
  { filter: null },
  { filter: 123 },
  { library: "nextjs" },
])(
  "rejects invalid tool input before calling the service: %j",
  async (input) => {
    const service = { listLibraries: vi.fn() };
    const client = await connect(service);
    const result = await client.callTool({
      name: "list_libraries",
      arguments: input,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(service.listLibraries).not.toHaveBeenCalled();
  },
);

test("preserves operational error codes and messages in a failed tool result", async () => {
  const error = new DocumentationError("INVALID_REQUEST", "Invalid filter");
  const service = {
    listLibraries: vi.fn(() => {
      throw error;
    }),
  };

  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  const client = await connect(service);
  const result = await client.callTool({
    name: "list_libraries",
    arguments: {},
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(JSON.parse(result.content[0].text)).toEqual({
    code: "INVALID_REQUEST",
    message: "Invalid filter",
  });
  expect(log).not.toHaveBeenCalled();
});

test("logs unexpected failures and returns an internal error without exposing details", async () => {
  const error = new Error("Private registry failure");
  const service = {
    listLibraries: vi.fn(() => {
      throw error;
    }),
  };

  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  const client = await connect(service);
  const result = await client.callTool({
    name: "list_libraries",
    arguments: {},
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(JSON.parse(result.content[0].text)).toEqual({
    code: "INTERNAL_ERROR",
    message: "Could not list supported libraries.",
  });
  expect(log).toHaveBeenCalledExactlyOnceWith("[list_libraries]", error);
});

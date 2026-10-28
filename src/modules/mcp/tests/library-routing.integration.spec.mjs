import "reflect-metadata";
import { Inject, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import {
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { CodeExamplesService } from "../../../../dist/modules/code-examples/code-examples.service.js";
import { DocumentationService } from "../../../../dist/modules/documentation/documentation.service.js";
import { LibraryRegistry } from "../../../../dist/modules/libraries/library-registry.service.js";
import { LibraryService } from "../../../../dist/modules/libraries/library.service.js";
import { VersionService } from "../../../../dist/modules/libraries/version.service.js";
import { SearchService } from "../../../../dist/modules/search/search.service.js";
import { GetCodeExamplesTool } from "../../../../dist/modules/mcp/tools/get-code-examples.tool.js";
import { GetDocumentationTool } from "../../../../dist/modules/mcp/tools/get-documentation.tool.js";
import { ListLibrariesTool } from "../../../../dist/modules/mcp/tools/list-libraries.tool.js";
import { ListVersionsTool } from "../../../../dist/modules/mcp/tools/list-versions.tool.js";
import { SearchDocsTool } from "../../../../dist/modules/mcp/tools/search-docs.tool.js";
import { LIBRARY_SOURCE_OPTIONS } from "../../../../dist/modules/sources/constants/library-source-options.constant.js";
import { LibrarySourcesModule } from "../../../../dist/modules/sources/library-sources.module.js";

// This source uses a dotted filename, which Next.js paths do not support
const path = "guide/api.v2.md";
const tools = [
  GetDocumentationTool,
  SearchDocsTool,
  GetCodeExamplesTool,
  ListVersionsTool,
  ListLibrariesTool,
];

class FixtureAdapter {
  constructor(options) {
    this.libraryId = options.id;
    this.documentFormat = "markdown";
    this.isValidPath = vi.fn(
      (value) => value === "guide" || /^guide\/[a-z0-9.-]+\.md$/.test(value),
    );
    this.fetchCatalog = vi.fn(async () => ({
      libraryId: options.id,
      sourceUrl: options.sources.catalog.url,
      fetchedAt: "2026-10-28T10:00:00.000Z",
      docVersion: `${options.id}-1`,
      documents: [
        {
          path,
          title: options.id,
          sourceUrl: new URL(path, options.documentationUrl).href,
        },
      ],
    }));

    this.fetchDocument = vi.fn(async (documentPath) => ({
      libraryId: options.id,
      path: documentPath,
      sourceUrl: new URL(documentPath, options.documentationUrl).href,
      fetchedAt: "2026-10-28T10:00:00.000Z",
      format: "markdown",
      content: `# ${options.id} manual\n\n## Refresh\n\nRefresh ${options.id} data.\n\n\`\`\`ts\nrefresh("${options.id}")\n\`\`\``,
    }));

    this.listDocumentationSets = vi.fn(async (signal, fetchOptions) => {
      const catalog = await this.fetchCatalog(signal, fetchOptions);

      return {
        documentationSets: [
          {
            id: "current",
            label: `Current ${options.name} documentation`,
            channel: "current",
            declaredVersion: catalog.docVersion,
            versionRange: null,
            sourceUrl: options.documentationUrl,
          },
        ],
        catalog: { sourceUrl: catalog.sourceUrl, fetchedAt: catalog.fetchedAt },
      };
    });
  }
}

Inject(LIBRARY_SOURCE_OPTIONS)(FixtureAdapter, undefined, 0);

class DisabledAdapter extends FixtureAdapter {
  constructor() {
    throw new Error("Disabled adapters must not be instantiated");
  }
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Fixture sources must not use HTTP");
    }),
  );
});

afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

async function connect() {
  const definitions = Object.fromEntries(
    ["alpha", "beta", "disabled"].map((id) => [
      id,
      {
        enabled: id !== "disabled",
        name: `${id.toUpperCase()} Library`,
        documentationUrl: `https://${id}.example/manual/`,
        sources: {
          catalog: {
            format: "llms-txt",
            url: `https://${id}.example/catalog.txt`,
          },
        },
        adapter: id === "disabled" ? DisabledAdapter : FixtureAdapter,
      },
    ]),
  );

  class TestModule {}
  Module({
    imports: [LibrarySourcesModule.register(definitions)],
    providers: [
      LibraryRegistry,
      LibraryService,
      DocumentationService,
      SearchService,
      VersionService,
      CodeExamplesService,
      ...tools,
    ],
  })(TestModule);

  const app = await NestFactory.createApplicationContext(TestModule, {
    logger: false,
    abortOnError: false,
  });
  const server = new McpServer({ name: "routing-test", version: "1.0.0" });
  const client = new Client({ name: "routing-client", version: "1.0.0" });

  onTestFinished(async () => {
    await client.close();
    await server.close();
    await app.close();
  });

  for (const tool of tools) {
    app.get(tool).register(server);
  }

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, registry: app.get(LibraryRegistry) };
}

function expectNoSourceCalls(registry) {
  for (const { adapter } of registry.list()) {
    expect(adapter.fetchCatalog).not.toHaveBeenCalled();
    expect(adapter.fetchDocument).not.toHaveBeenCalled();
  }
}

test("MCP discovery uses generic schemas and lists libraries supplied at bootstrap", async () => {
  const { client, registry } = await connect();
  const { tools: discovered } = await client.listTools();

  expect(discovered).toHaveLength(5);
  expect(JSON.stringify(discovered)).not.toMatch(
    /nextjs|Next\.js|Pages Router|relative to \/docs/,
  );

  for (const tool of discovered.filter(
    ({ name }) => name !== "list_libraries",
  )) {
    expect(tool.inputSchema.properties.library).toMatchObject({
      type: "string",
    });
    expect(tool.inputSchema.properties.library).not.toHaveProperty("enum");
    expect(tool.inputSchema.properties.library).not.toHaveProperty("const");
  }

  const result = await client.callTool({
    name: "list_libraries",
    arguments: {},
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent.libraries.map(({ id }) => id)).toEqual([
    "alpha",
    "beta",
  ]);
  expectNoSourceCalls(registry);
});

test.each(["alpha", "beta"])(
  "all library tools select %s and return usable retrieval arguments",
  async (library) => {
    const { client, registry } = await connect();
    const adapter = registry.get(library).adapter;
    const sourceUrl = `https://${library}.example/manual/${path}`;

    const call = (name, args = {}) =>
      client.callTool({ name, arguments: { library, refresh: true, ...args } });
    const document = await call("get_documentation", { path });

    expect(document.isError).not.toBe(true);
    expect(document.structuredContent).toMatchObject({
      libraryId: library,
      path,
      sourceUrl,
    });
    expect(document.structuredContent.content).toContain(
      `refresh("${library}")`,
    );

    const search = await call("search_docs", {
      query: "refresh",
      path_prefix: "guide",
    });

    expect(search.isError).not.toBe(true);
    expect(search.structuredContent.libraryId).toBe(library);
    expect(search.structuredContent.results.length).toBeGreaterThan(0);

    for (const result of search.structuredContent.results) {
      expect(result.sourceUrl).toBe(sourceUrl);
      expect(result.getDocumentation.library).toBe(library);
    }

    const examples = await call("get_code_examples", {
      query: "refresh",
      filters: { path_prefix: path },
    });

    expect(examples.isError).not.toBe(true);
    expect(examples.structuredContent).toMatchObject({
      libraryId: library,
      totalMatches: 1,
    });

    const example = examples.structuredContent.examples[0];

    expect(example.code).toBe(`refresh("${library}")`);
    expect(example.getDocumentation.library).toBe(library);

    const followup = await client.callTool({
      name: "get_documentation",
      arguments: example.getDocumentation,
    });

    expect(followup.isError).not.toBe(true);
    expect(followup.structuredContent.content).toContain(example.code);

    const versions = await call("list_versions");

    expect(versions.isError).not.toBe(true);
    expect(versions.structuredContent).toMatchObject({
      library,
      documentationSets: [
        {
          id: "current",
          label: `Current ${library.toUpperCase()} Library documentation`,
          declaredVersion: `${library}-1`,
          sourceUrl: `https://${library}.example/manual/`,
        },
      ],
    });
    expect(adapter.fetchCatalog).toHaveBeenCalledTimes(3);
    expect(
      adapter.fetchCatalog.mock.calls.every(
        ([, options]) => options.refresh === true,
      ),
    ).toBe(true);

    const other = registry.get(library === "alpha" ? "beta" : "alpha").adapter;

    expect(other.fetchCatalog).not.toHaveBeenCalled();
    expect(other.fetchDocument).not.toHaveBeenCalled();
  },
);

test.each(["missing", "disabled"])(
  "%s is rejected consistently before source loading",
  async (library) => {
    const { client, registry } = await connect();

    for (const [name, args] of [
      ["get_documentation", { path }],
      ["search_docs", { query: "refresh" }],
      ["list_versions", {}],
      ["get_code_examples", { query: "refresh" }],
      ["get_code_examples", { query: "refresh", version: "14" }],
    ]) {
      const result = await client.callTool({
        name,
        arguments: { library, ...args },
      });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual({
        code: "INVALID_REQUEST",
        message: "Unsupported library.",
      });
    }
    expectNoSourceCalls(registry);
  },
);

test("source-specific path validation runs before loading documents or catalogs", async () => {
  const { client, registry } = await connect();
  const invalidPath = "guide/missing-extension";

  for (const [name, args] of [
    ["get_documentation", { path: invalidPath }],
    ["search_docs", { query: "refresh", path_prefix: invalidPath }],
    [
      "get_code_examples",
      { query: "refresh", filters: { path_prefix: invalidPath } },
    ],
  ]) {
    const result = await client.callTool({
      name,
      arguments: { library: "alpha", ...args },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe("INVALID_REQUEST");
  }

  expect(registry.get("alpha").adapter.isValidPath).toHaveBeenCalledTimes(3);
  expect(registry.get("beta").adapter.isValidPath).not.toHaveBeenCalled();
  expectNoSourceCalls(registry);
});

test.each([
  "../secret",
  "guide/../secret",
  "guide/./page.md",
  "/guide/page.md",
  "guide/",
  "https://other.example/page",
  "guide/%2e%2e/secret",
  "guide\\secret",
  "guide/page.md?x=1",
  "guide/page.md#section",
  "guide/\u0000page.md",
])(
  "common path validation rejects unsafe paths before the adapter: %j",
  async (invalidPath) => {
    const { client, registry } = await connect();

    for (const [name, args] of [
      ["get_documentation", { path: invalidPath }],
      ["search_docs", { query: "refresh", path_prefix: invalidPath }],
      [
        "get_code_examples",
        { query: "refresh", filters: { path_prefix: invalidPath } },
      ],
    ]) {
      const result = await client.callTool({
        name,
        arguments: { library: "alpha", ...args },
      });

      expect(result.isError).toBe(true);
    }

    expect(registry.get("alpha").adapter.isValidPath).not.toHaveBeenCalled();
    expectNoSourceCalls(registry);
  },
);

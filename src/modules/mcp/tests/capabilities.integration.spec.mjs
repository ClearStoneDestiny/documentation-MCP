import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import {
  describe,
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { CodeExamplesService } from "../../../../dist/modules/code-examples/code-examples.service.js";
import { DocumentationService } from "../../../../dist/modules/documentation/documentation.service.js";
import { DocumentPipelineRegistry } from "../../../../dist/modules/documentation/document-pipeline-registry.service.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";
import { createMarkdownPipeline } from "../../../../dist/modules/documentation/pipelines/markdown.pipeline.js";
import { LIBRARY_REGISTRATIONS } from "../../../../dist/modules/libraries/constants/library-registrations.constant.js";
import { LibraryRegistry } from "../../../../dist/modules/libraries/library-registry.service.js";
import { LibraryService } from "../../../../dist/modules/libraries/library.service.js";
import { VersionService } from "../../../../dist/modules/libraries/version.service.js";
import { createLibraryRegistration } from "../../../../dist/modules/libraries/utils/create-library-registration.util.js";
import { GetCodeExamplesTool } from "../../../../dist/modules/mcp/tools/get-code-examples.tool.js";
import { GetDocumentationTool } from "../../../../dist/modules/mcp/tools/get-documentation.tool.js";
import { ListLibrariesTool } from "../../../../dist/modules/mcp/tools/list-libraries.tool.js";
import { ListVersionsTool } from "../../../../dist/modules/mcp/tools/list-versions.tool.js";
import { SearchDocsTool } from "../../../../dist/modules/mcp/tools/search-docs.tool.js";
import { SearchService } from "../../../../dist/modules/search/search.service.js";
import { SectionIndex } from "../../../../dist/modules/search/section-index.js";

describe("MCP capabilities", () => {
  const toolClasses = [
    GetDocumentationTool,
    SearchDocsTool,
    GetCodeExamplesTool,
    ListVersionsTool,
    ListLibrariesTool,
  ];

  const calls = [
    ["get_documentation", { path: "guide/example" }],
    ["search_docs", { query: "refresh" }],
    ["list_versions", {}],
    ["get_code_examples", { query: "refresh" }],
  ];
  
  const allTools = calls.map(([name]) => name);

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Capability discovery must remain local");
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

  function fixture(id, options = {}) {
    const parser = new MarkdownDocumentParser();
    const parse = vi.spyOn(parser, "parse");

    const createIndex = vi.fn(() => new SectionIndex());
    const pipeline = { ...createMarkdownPipeline(parser), createIndex };

    if (options.noIndex) {
      delete pipeline.createIndex;
    }

    const pipelines = new DocumentPipelineRegistry(
      options.noParser ? [] : [pipeline],
    );

    const adapter = {
      libraryId: id,
      documentFormat: options.format ?? "markdown",
      isValidPath: vi.fn(() => true),

      fetchCatalog: vi.fn(async function () {
        return {
          libraryId: this.libraryId,
          sourceUrl: `https://${id}.example/catalog.txt`,
          fetchedAt: "2026-10-28T10:00:00.000Z",
          docVersion: "1.0.0",
          documents: [
            {
              path: "guide/example",
              title: id,
              sourceUrl: `https://${id}.example/guide/example`,
            },
          ],
        };
      }),

      fetchDocument: vi.fn(async function (path) {
        return {
          libraryId: this.libraryId,
          path,
          sourceUrl: `https://${id}.example/${path}`,
          format: options.format ?? "markdown",
          fetchedAt: "2026-10-28T10:00:00.000Z",
          content: `# ${id}\n\n## Refresh\n\nRefresh data.\n\n\`\`\`ts\nrefresh()\n\`\`\``,
        };
      }),

      listDocumentationSets: vi.fn(async function (signal, fetchOptions) {
        const catalog = this.fetchCatalog
          ? await this.fetchCatalog(signal, fetchOptions)
          : undefined;

        return {
          documentationSets: [
            {
              id: "current",
              label: `${id} live documentation`,
              channel: "current",
              declaredVersion: catalog?.docVersion ?? null,
              versionRange: null,
              sourceUrl: `https://${id}.example/`,
            },
          ],
          ...(catalog
            ? {
                catalog: {
                  sourceUrl: catalog.sourceUrl,
                  fetchedAt: catalog.fetchedAt,
                },
              }
            : {}),
        };
      }),

      // These unsupported promises must not affect the resolved operations
      historicalDocumentation: true,
      capabilities: { tools: allTools, historicalDocumentation: true },
    };

    if (options.noCatalog) {
      delete adapter.fetchCatalog;
    }

    if (options.noSets) {
      delete adapter.listDocumentationSets;
    }

    if (options.noDocuments) {
      delete adapter.fetchDocument;
    }

    if (options.noFormat) {
      delete adapter.documentFormat;
    }

    if (options.noPathValidation) {
      delete adapter.isValidPath;
    }

    const definition = {
      enabled: true,
      name: id,
      documentationUrl: `https://${id}.example/`,
      sources: {},
      adapter: class {},
      capabilities: { tools: allTools, historicalDocumentation: true },
    };

    return {
      adapter,
      parse,
      createIndex,
      registration: createLibraryRegistration(
        id,
        definition,
        adapter,
        pipelines,
      ),
    };
  }

  async function connect(fixtures) {
    class TestModule {}
    Module({
      providers: [
        {
          provide: LIBRARY_REGISTRATIONS,
          useValue: fixtures.map(({ registration }) => registration),
        },
        LibraryRegistry,
        LibraryService,
        DocumentationService,
        SearchService,
        VersionService,
        CodeExamplesService,
        ...toolClasses,
      ],
    })(TestModule);

    const app = await NestFactory.createApplicationContext(TestModule, {
      logger: false,
      abortOnError: false,
    });

    const server = new McpServer({
      name: "capabilities-test",
      version: "1.0.0",
    });
    const client = new Client({
      name: "capabilities-client",
      version: "1.0.0",
    });

    onTestFinished(async () => {
      await client.close();
      await server.close();
      await app.close();
    });

    for (const tool of toolClasses) {
      app.get(tool).register(server);
    }

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    return { client, app };
  }

  function counts(item) {
    return [
      item.adapter.isValidPath,
      item.adapter.fetchCatalog,
      item.adapter.fetchDocument,
      item.parse,
      item.createIndex,
      item.adapter.listDocumentationSets,
    ].map((method) => method?.mock.calls.length ?? 0);
  }

  test.each([
    ["full", {}, allTools],
    ["direct", { noCatalog: true, noSets: true }, ["get_documentation"]],
    [
      "direct-with-sets",
      { noCatalog: true },
      ["get_documentation", "list_versions"],
    ],
    ["catalog-without-sets", { noDocuments: true, noSets: true }, []],
    [
      "full-without-sets",
      { noSets: true },
      ["get_documentation", "search_docs", "get_code_examples"],
    ],
    [
      "catalog",
      { noDocuments: true, noPathValidation: true, noFormat: true },
      ["list_versions"],
    ],
    ["unsupported-format", { format: "html" }, ["list_versions"]],
    ["no-parser", { noParser: true }, ["list_versions"]],
    ["no-index", { noIndex: true }, ["get_documentation", "list_versions"]],
    ["no-format", { noFormat: true }, ["list_versions"]],
    ["no-path-validation", { noPathValidation: true }, ["list_versions"]],
    ["sets-only", { noDocuments: true, noCatalog: true }, ["list_versions"]],
    ["no-operations", { noDocuments: true, noCatalog: true, noSets: true }, []],
  ])(
    "%s advertises exactly the operations that its source and installed pipeline can execute",
    async (id, options, supported) => {
      const item = fixture(id, options);
      const { client } = await connect([item]);

      expect(counts(item)).toEqual([0, 0, 0, 0, 0, 0]);

      const listed = await client.callTool({
        name: "list_libraries",
        arguments: {},
      });

      expect(listed.isError).not.toBe(true);
      expect(listed.structuredContent.libraries[0].capabilities).toEqual({
        tools: supported,
        historicalDocumentation: false,
      });
      expect(counts(item)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(Object.isFrozen(item.registration.operations)).toBe(true);

      for (const [name, args] of calls) {
        const before = counts(item);
        const result = await client.callTool({
          name,
          arguments: { library: id, ...args },
        });

        if (supported.includes(name)) {
          expect(result.isError, name).not.toBe(true);

          if (name === "get_documentation") {
            expect(result.structuredContent.content).toContain("refresh()");
          }

          if (name === "search_docs") {
            expect(result.structuredContent.results.length).toBeGreaterThan(0);
          }

          if (name === "get_code_examples") {
            expect(result.structuredContent.examples[0].code).toBe("refresh()");
          }
        } else {
          expect(result.isError, name).toBe(true);
          expect(JSON.parse(result.content[0].text)).toEqual({
            code: "TOOL_UNSUPPORTED",
            message: `${name} is not supported for library ${id}.`,
          });
          expect(counts(item)).toEqual(before);
        }
      }
      if (id === "full") {
        expect(item.parse).toHaveBeenCalledTimes(3);
        expect(item.createIndex).toHaveBeenCalledTimes(2);
      }
    },
  );

  test("multiple libraries keep different capabilities within the same server", async () => {
    const full = fixture("full");
    const direct = fixture("direct", { noCatalog: true, noSets: true });

    const { client } = await connect([full, direct]);
    const listed = await client.callTool({
      name: "list_libraries",
      arguments: {},
    });

    expect(
      listed.structuredContent.libraries.map(({ id, capabilities }) => [
        id,
        capabilities.tools,
      ]),
    ).toEqual([
      ["full", allTools],
      ["direct", ["get_documentation"]],
    ]);

    const unsupported = await client.callTool({
      name: "search_docs",
      arguments: { library: "direct", query: "refresh" },
    });

    expect(JSON.parse(unsupported.content[0].text).code).toBe(
      "TOOL_UNSUPPORTED",
    );
    expect(counts(full)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(counts(direct)).toEqual([0, 0, 0, 0, 0, 0]);

    const supported = await client.callTool({
      name: "search_docs",
      arguments: { library: "full", query: "refresh" },
    });

    expect(supported.isError).not.toBe(true);
    expect(counts(direct)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("temporary source failures preserve capabilities and remain SOURCE_ERROR rather than unsupported", async () => {
    const item = fixture("full");
    const originals = {
      catalog: item.adapter.fetchCatalog.getMockImplementation(),
      document: item.adapter.fetchDocument.getMockImplementation(),
    };

    const { client } = await connect([item]);
    const list = () =>
      client.callTool({ name: "list_libraries", arguments: {} });

    const before = (await list()).structuredContent;

    item.adapter.fetchCatalog.mockRejectedValue(
      new Error("Temporary source outage"),
    );
    item.adapter.fetchDocument.mockRejectedValue(
      new Error("Temporary source outage"),
    );

    for (const [name, args] of calls) {
      const result = await client.callTool({
        name,
        arguments: { library: "full", ...args },
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).code).toBe("SOURCE_ERROR");
    }

    expect((await list()).structuredContent).toEqual(before);

    item.adapter.fetchCatalog.mockImplementation(originals.catalog);
    item.adapter.fetchDocument.mockImplementation(originals.document);

    for (const [name, args] of calls) {
      const result = await client.callTool({
        name,
        arguments: { library: "full", ...args },
      });
      expect(result.isError).not.toBe(true);
    }

    expect((await list()).structuredContent).toEqual(before);
  });

  test("an adapter cannot enable historical routing through flags or catalog version metadata", async () => {
    const item = fixture("full");

    const { client } = await connect([item]);
    const result = await client.callTool({
      name: "get_code_examples",
      arguments: { library: "full", query: "refresh", version: "1.0.0" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe("VERSION_UNAVAILABLE");
    expect(counts(item)).toEqual([0, 0, 0, 0, 0, 0]);

    const listed = await client.callTool({
      name: "list_libraries",
      arguments: {},
    });

    expect(
      listed.structuredContent.libraries[0].capabilities
        .historicalDocumentation,
    ).toBe(false);
  });

  test("a document's actual format is checked before Markdown parsing", async () => {
    const item = fixture("full");

    item.adapter.fetchDocument.mockResolvedValue({
      libraryId: "full",
      path: "guide/example",
      sourceUrl: "https://full.example/guide/example",
      format: "html",
      content: "<h1>Not Markdown</h1>",
      fetchedAt: "2026-10-28T10:00:00.000Z",
    });

    const { client } = await connect([item]);
    const result = await client.callTool({
      name: "get_documentation",
      arguments: { library: "full", path: "guide/example" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe("PARSE_ERROR");
    expect(item.registration.capabilities.tools).toEqual(allTools);
  });
});

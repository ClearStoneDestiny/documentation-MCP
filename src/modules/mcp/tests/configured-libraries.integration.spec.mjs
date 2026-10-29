import "reflect-metadata";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { LIBRARY_DEFINITIONS } from "../../../../dist/modules/libraries/constants/library-definitions.constant.js";
import { LibraryRegistry } from "../../../../dist/modules/libraries/library-registry.service.js";
import { LibraryService } from "../../../../dist/modules/libraries/library.service.js";
import { VersionService } from "../../../../dist/modules/libraries/version.service.js";
import { DocumentationService } from "../../../../dist/modules/documentation/documentation.service.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";
import { SearchService } from "../../../../dist/modules/search/search.service.js";
import { CodeExamplesService } from "../../../../dist/modules/code-examples/code-examples.service.js";
import { FileCacheService } from "../../../../dist/modules/cache/file-cache.service.js";
import { LibrarySourcesModule } from "../../../../dist/modules/sources/library-sources.module.js";
import { ReactAdapter } from "../../../../dist/modules/sources/adapters/react.adapter.js";
import { GetDocumentationTool } from "../../../../dist/modules/mcp/tools/get-documentation.tool.js";
import { SearchDocsTool } from "../../../../dist/modules/mcp/tools/search-docs.tool.js";
import { GetCodeExamplesTool } from "../../../../dist/modules/mcp/tools/get-code-examples.tool.js";
import { ListVersionsTool } from "../../../../dist/modules/mcp/tools/list-versions.tool.js";
import { ListLibrariesTool } from "../../../../dist/modules/mcp/tools/list-libraries.tool.js";

const fixture = (name) =>
  readFileSync(
    new URL(`../../sources/tests/fixtures/${name}`, import.meta.url),
    "utf8",
  );

const toolClasses = [
  GetDocumentationTool,
  SearchDocsTool,
  GetCodeExamplesTool,
  ListVersionsTool,
  ListLibrariesTool,
];

const toolNames = [
  "get_documentation",
  "search_docs",
  "list_versions",
  "get_code_examples",
];

const requests = {
  nextjs: {
    path: "app/guides/caching",
    query: "revalidateTag",
    language: "ts",
    title: "Caching",
    declaredVersion: "99.1.0",
  },

  react: {
    path: "reference/react/useState",
    query: "useState",
    language: "jsx",
    title: "useState",
    declaredVersion: null,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function connect(definitions = LIBRARY_DEFINITIONS) {
  const directory = await mkdtemp(
    join(tmpdir(), "documentation-mcp-configured-"),
  );

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  vi.stubEnv("DOCUMENTATION_MCP_CACHE_DIR", directory);
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_TTL_MS", "3600000");
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_ENABLED", "true");

  const responses = new Map();

  for (const [id, request] of Object.entries(requests)) {
    const definition = LIBRARY_DEFINITIONS[id];

    responses.set(definition.sources.catalog.url, {
      content: fixture(id === "react" ? "react-llms.txt" : "nextjs-llms.txt"),
      etag: `"${id}-catalog-1"`,
    });

    responses.set(
      new URL(`${request.path}.md`, definition.documentationUrl).href,
      {
        content:
          id === "react"
            ? fixture("react-use-state.md")
            : "# Caching\n\n## Tags\n\nRevalidate stored tags.\n\n```ts\nrevalidateTag('posts')\n```",
        etag: `"${id}-page-1"`,
      },
    );
  }

  const fetchMock = vi.fn(async (url, init) => {
    const response = responses.get(url);

    if (!response) {
      throw new Error(`Unexpected source request: ${url}`);
    }

    if (response.status) {
      return new Response("Source error", { status: response.status });
    }

    if (init.headers.get("If-None-Match") === response.etag) {
      return new Response(null, { status: 304 });
    }

    return new Response(response.content, {
      headers: { "Content-Type": "text/plain", ETag: response.etag },
    });
  });

  vi.stubGlobal("fetch", fetchMock);

  class TestModule {}
  Module({
    imports: [LibrarySourcesModule.register(definitions)],
    providers: [
      LibraryRegistry,
      LibraryService,
      VersionService,
      DocumentationService,
      SearchService,
      CodeExamplesService,
      ...toolClasses,
    ],
  })(TestModule);

  const app = await NestFactory.createApplicationContext(TestModule, {
    logger: false,
    abortOnError: false,
  });

  const server = new McpServer({
    name: "configured-libraries-test",
    version: "1.0.0",
  });
  const client = new Client({ name: "contract-client", version: "1.0.0" });

  onTestFinished(async () => {
    await client.close();
    await server.close();
    await app.close();
  });

  for (const tool of toolClasses) app.get(tool).register(server);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, app, directory, responses, fetchMock };
}

test.each(["nextjs", "react"])(
  "the configured %s adapter fulfills every advertised MCP operation",
  async (library) => {
    const { client, fetchMock, app } = await connect();

    const request = requests[library];
    const definition = LIBRARY_DEFINITIONS[library];

    expect(fetchMock).not.toHaveBeenCalled();

    const libraries = await client.callTool({
      name: "list_libraries",
      arguments: {},
    });

    expect(libraries.structuredContent.libraries.map(({ id }) => id)).toEqual([
      "nextjs",
      "react",
    ]);

    for (const entry of libraries.structuredContent.libraries) {
      expect(entry.capabilities).toEqual({
        tools: toolNames,
        historicalDocumentation: false,
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();

    const versions = await client.callTool({
      name: "list_versions",
      arguments: { library },
    });

    expect(versions.isError).not.toBe(true);
    expect(versions.structuredContent.documentationSets).toEqual([
      {
        id: "current",
        channel: "current",
        label: `Current ${definition.name} documentation`,
        declaredVersion: request.declaredVersion,
        versionRange: null,
        sourceUrl: definition.documentationUrl,
      },
    ]);

    const document = await client.callTool({
      name: "get_documentation",
      arguments: { library, path: request.path },
    });

    expect(document.isError).not.toBe(true);
    expect(document.structuredContent).toMatchObject({
      libraryId: library,
      path: request.path,
      title: request.title,
    });

    const search = await client.callTool({
      name: "search_docs",
      arguments: { library, query: request.query, path_prefix: request.path },
    });

    expect(search.isError).not.toBe(true);
    expect(search.structuredContent.results.length).toBeGreaterThan(0);
    expect(search.structuredContent.coverage).toMatchObject({
      selectedDocuments: 1,
      indexedDocuments: 1,
      failedDocuments: 0,
      partial: false,
    });

    for (const result of search.structuredContent.results) {
      expect(result.getDocumentation.library).toBe(library);

      const retrieved = await client.callTool({
        name: "get_documentation",
        arguments: result.getDocumentation,
      });

      expect(retrieved.isError).not.toBe(true);
      expect(retrieved.structuredContent.contentHash).toBe(
        document.structuredContent.contentHash,
      );
    }

    const examples = await client.callTool({
      name: "get_code_examples",
      arguments: {
        library,
        query: request.query,
        filters: { path_prefix: request.path, languages: [request.language] },
      },
    });

    expect(examples.isError).not.toBe(true);
    expect(examples.structuredContent).toMatchObject({
      libraryId: library,
      version: "current",
      totalMatches: 1,
    });

    const example = examples.structuredContent.examples[0];

    expect(example.language).toBe(request.language);
    expect(example.code).toContain(request.query);
    expect(example.getDocumentation.library).toBe(library);

    const retrieved = await client.callTool({
      name: "get_documentation",
      arguments: example.getDocumentation,
    });

    expect(retrieved.isError).not.toBe(true);
    expect(retrieved.structuredContent.content).toContain(example.code);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.every(([url]) =>
        url.startsWith(definition.documentationUrl),
      ),
    ).toBe(true);

    const saved = await app.get(FileCacheService).read({
      libraryId: library,
      documentationSetId: "current",
      url: new URL(`${request.path}.md`, definition.documentationUrl).href,
    });

    expect(saved.content).toBe(document.structuredContent.content);
  },
);

test("React refresh and removal leave Next.js cached content, hashes, and index reusable", async () => {
  const { client, fetchMock, app, directory, responses } = await connect();
  const parser = vi.spyOn(app.get(MarkdownDocumentParser), "parse");

  const search = (library, extra = {}) =>
    client.callTool({
      name: "search_docs",
      arguments: {
        library,
        query: requests[library].query,
        path_prefix: requests[library].path,
        ...extra,
      },
    });

  const firstNext = await search("nextjs");
  const react = await search("react");

  expect(firstNext.isError).not.toBe(true);
  expect(react.isError).not.toBe(true);

  const next = await search("nextjs");

  expect(parser).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledTimes(4);

  const reactUrl = "https://react.dev/reference/react/useState.md";
  responses.set(reactUrl, {
    content: "# Replacement\n\nReplacementmarker.\n\n```js\nuseState(1)\n```",
    etag: '"react-page-2"',
  });

  const changed = await search("react", {
    refresh: true,
    query: "replacementmarker",
  });

  expect(changed.isError).not.toBe(true);
  expect(changed.structuredContent.results[0].contentHash).not.toBe(
    react.structuredContent.results[0].contentHash,
  );

  const unaffected = await search("nextjs");

  expect(unaffected.structuredContent.results).toEqual(
    next.structuredContent.results,
  );
  expect(parser).toHaveBeenCalledTimes(3);

  responses.set(reactUrl, { status: 404 });
  const missing = await search("react", { refresh: true });

  expect(missing.isError).toBe(true);
  expect(JSON.parse(missing.content[0].text).code).toBe("INDEX_UNAVAILABLE");
  expect((await search("nextjs")).structuredContent.results).toEqual(
    next.structuredContent.results,
  );
  expect(parser).toHaveBeenCalledTimes(3);

  const store = app.get(FileCacheService);

  expect(
    await store.read({
      libraryId: "react",
      documentationSetId: "current",
      url: reactUrl,
    }),
  ).toBeNull();

  const nextSaved = await store.read({
    libraryId: "nextjs",
    documentationSetId: "current",
    url: "https://nextjs.org/docs/app/guides/caching.md",
  });

  expect(nextSaved.content).toContain("revalidateTag");

  const records = await Promise.all(
    (await readdir(join(directory, "v2"))).map(async (file) =>
      JSON.parse(await readFile(join(directory, "v2", file), "utf8")),
    ),
  );

  expect(new Set(records.map(({ libraryId }) => libraryId))).toEqual(
    new Set(["nextjs", "react"]),
  );
  expect(
    records.every(({ documentationSetId }) => documentationSetId === "current"),
  ).toBe(true);
});

test("disabling React prevents adapter construction and every React tool while Next.js keeps working", async () => {
  class DisabledReactAdapter extends ReactAdapter {
    constructor() {
      throw new Error("Disabled React must not be instantiated");
    }
  }

  const { client, fetchMock } = await connect({
    ...LIBRARY_DEFINITIONS,
    react: {
      ...LIBRARY_DEFINITIONS.react,
      enabled: false,
      adapter: DisabledReactAdapter,
    },
  });

  const libraries = await client.callTool({
    name: "list_libraries",
    arguments: {},
  });

  expect(libraries.structuredContent.libraries.map(({ id }) => id)).toEqual([
    "nextjs",
  ]);

  for (const [name, args] of [
    ["get_documentation", { path: requests.react.path }],
    ["search_docs", { query: "useState" }],
    ["get_code_examples", { query: "useState" }],
    ["list_versions", {}],
  ]) {
    const result = await client.callTool({
      name,
      arguments: { library: "react", ...args },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe("INVALID_REQUEST");
  }

  expect(fetchMock).not.toHaveBeenCalled();

  const next = await client.callTool({
    name: "search_docs",
    arguments: {
      library: "nextjs",
      query: requests.nextjs.query,
      path_prefix: requests.nextjs.path,
    },
  });

  expect(next.isError).not.toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    fetchMock.mock.calls.every(([url]) =>
      url.startsWith("https://nextjs.org/docs/"),
    ),
  ).toBe(true);
});

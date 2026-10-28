import "reflect-metadata";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Inject, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { AppModule } from "../../../../dist/app.module.js";
import { CodeExamplesService } from "../../../../dist/modules/code-examples/code-examples.service.js";
import { DocumentationService } from "../../../../dist/modules/documentation/documentation.service.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";
import { LIBRARY_DEFINITIONS } from "../../../../dist/modules/libraries/constants/library-definitions.constant.js";
import { LibraryRegistry } from "../../../../dist/modules/libraries/library-registry.service.js";
import { LibraryService } from "../../../../dist/modules/libraries/library.service.js";
import { VersionService } from "../../../../dist/modules/libraries/version.service.js";
import { SearchService } from "../../../../dist/modules/search/search.service.js";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";
import { LIBRARY_SOURCE_OPTIONS } from "../../../../dist/modules/sources/constants/library-source-options.constant.js";
import { LibrarySourcesModule } from "../../../../dist/modules/sources/library-sources.module.js";
import { CachedMarkdownService } from "../../../../dist/modules/sources/services/cached-markdown.service.js";

beforeEach(() => {
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_ENABLED", "false");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Startup and library discovery must remain local");
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function boot(sources) {
  class TestModule {}
  Module({
    imports: [sources],
    providers: [
      LibraryRegistry,
      LibraryService,
      MarkdownDocumentParser,
      DocumentationService,
      SearchService,
      VersionService,
      CodeExamplesService,
    ],
  })(TestModule);

  const app = await NestFactory.createApplicationContext(TestModule, {
    logger: false,
    abortOnError: false,
  });

  onTestFinished(() => app.close());
  return app;
}

test("the application shares one configured Next.js adapter without fetching sources", async () => {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });

  onTestFinished(() => app.close());

  const registry = app.get(LibraryRegistry);
  expect(registry.get("nextjs").adapter).toBeInstanceOf(NextjsAdapter);
  expect(() => app.get(NextjsAdapter)).toThrow();
  expect(app.get(LibraryService).listLibraries({}).libraries).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});

function fixtureAdapter() {
  const instances = [];

  class Adapter {
    constructor(markdown, options) {
      this.markdown = markdown;
      this.options = options;
      this.libraryId = options.id;
      instances.push(this);
    }

    async fetchCatalog() {
      throw new Error("Not called during startup");
    }
    async fetchDocument() {
      throw new Error("Not called during startup");
    }
    isValidPath() { return true; }
  }

  Inject(CachedMarkdownService)(Adapter, undefined, 0);
  Inject(LIBRARY_SOURCE_OPTIONS)(Adapter, undefined, 1);

  return { Adapter, instances };
}

test("Nest creates only enabled adapters and scopes options when libraries share a class", async () => {
  const { Adapter, instances } = fixtureAdapter();

  class DisabledAdapter extends Adapter {
    constructor() {
      throw new Error("A disabled adapter must never be created");
    }
  }

  const definition = { ...LIBRARY_DEFINITIONS.nextjs, adapter: Adapter };
  const app = await boot(
    LibrarySourcesModule.register({
      alpha: { ...definition, name: "Alpha" },
      beta: {
        ...definition,
        name: "Beta",
        documentationUrl: "https://beta.example/docs/",
      },
      disabled: { ...definition, enabled: false, adapter: DisabledAdapter },
    }),
  );
  const registry = app.get(LibraryRegistry);

  expect(registry.list().map(({ id }) => id)).toEqual(["alpha", "beta"]);
  expect(registry.get("disabled")).toBeUndefined();
  expect(instances).toHaveLength(2);
  expect(registry.get("alpha").adapter.options.id).toBe("alpha");
  expect(registry.get("beta").adapter.options).toMatchObject({
    id: "beta",
    documentationUrl: "https://beta.example/docs/",
  });
  expect(registry.get("alpha").adapter).not.toBe(registry.get("beta").adapter);
  expect(
    instances.every(
      ({ markdown }) => markdown instanceof CachedMarkdownService,
    ),
  ).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

test.each([{}, { nextjs: { ...LIBRARY_DEFINITIONS.nextjs, enabled: false } }])(
  "an empty enabled set boots all consumers and rejects requests without HTTP: %j",
  async (definitions) => {
    const app = await boot(LibrarySourcesModule.register(definitions));

    expect(app.get(LibraryService).listLibraries({})).toEqual({
      libraries: [],
    });
    expect(() => app.get(NextjsAdapter)).toThrow();

    await expect(
      app.get(DocumentationService).getDocumentation({
        library: "nextjs",
        path: "app/guides/example",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      app.get(SearchService).searchDocs({
        library: "nextjs",
        query: "cache",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      app.get(VersionService).listVersion({
        library: "nextjs",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      app.get(CodeExamplesService).getCodeExamples({
        library: "nextjs",
        query: "cache",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    expect(fetch).not.toHaveBeenCalled();
  },
);

test("configuration is snapshotted for a registration and changes apply to the next bootstrap", async () => {
  const { Adapter } = fixtureAdapter();
  const definitions = {
    nextjs: {
      ...LIBRARY_DEFINITIONS.nextjs,
      adapter: Adapter,
      sources: { catalog: { ...LIBRARY_DEFINITIONS.nextjs.sources.catalog } },
    },
  };
  const configured = LibrarySourcesModule.register(definitions);

  definitions.nextjs.enabled = false;
  definitions.nextjs.name = "Changed";
  definitions.nextjs.documentationUrl = "https://changed.example/docs/";
  definitions.nextjs.sources.catalog.url =
    "https://changed.example/catalog.txt";

  const app = await boot(configured);
  const registration = app.get(LibraryRegistry).get("nextjs");

  expect(registration.name).toBe("Next.js");
  expect(registration.adapter.options).toEqual({
    id: "nextjs",
    documentationUrl: LIBRARY_DEFINITIONS.nextjs.documentationUrl,
    sources: LIBRARY_DEFINITIONS.nextjs.sources,
  });
  expect(Object.isFrozen(registration)).toBe(true);
  expect(Object.isFrozen(registration.adapter.options.sources.catalog)).toBe(
    true,
  );

  const restarted = await boot(LibrarySourcesModule.register(definitions));

  expect(restarted.get(LibraryRegistry).list()).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test("Next.js uses configured URLs for catalog parsing and page loading", async () => {
  const documentationUrl = "https://mirror.example/framework/";
  const catalogUrl = "https://mirror.example/catalog.txt";

  fetch.mockImplementation(
    async (url) =>
      new Response(
        url === catalogUrl
          ? `# Docs\n\n- [Cache](${documentationUrl}app/cache.md)`
          : "# Cache\n\nConfigured source.",
        { headers: { "Content-Type": "text/markdown" } },
      ),
  );

  const app = await boot(
    LibrarySourcesModule.register({
      nextjs: {
        ...LIBRARY_DEFINITIONS.nextjs,
        documentationUrl,
        sources: { catalog: { format: "llms-txt", url: catalogUrl } },
      },
    }),
  );

  expect(fetch).not.toHaveBeenCalled();

  const adapter = app.get(LibraryRegistry).get("nextjs").adapter;
  const catalog = await adapter.fetchCatalog();
  const document = await adapter.fetchDocument(catalog.documents[0].path);

  expect(catalog.sourceUrl).toBe(catalogUrl);
  expect(catalog.documents[0]).toMatchObject({
    path: "app/cache",
    sourceUrl: `${documentationUrl}app/cache`,
  });
  expect(document.sourceUrl).toBe(`${documentationUrl}app/cache`);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    catalogUrl,
    `${documentationUrl}app/cache.md`,
  ]);
});

test.each([
  ["Bad ID", {}],
  ["nextjs", { enabled: "true" }],
  ["nextjs", { name: " " }],
  ["nextjs", { adapter: {} }],
  ["nextjs", { documentationUrl: "file:///docs/" }],
  ["nextjs", { documentationUrl: "https://user@nextjs.org/docs/" }],
  ["nextjs", { documentationUrl: "https://nextjs.org/docs" }],
  [
    "nextjs",
    { sources: { catalog: { format: "html", url: "https://example.com/" } } },
  ],
  ["nextjs", { sources: { catalog: { format: "llms-txt", url: "invalid" } } }],
])(
  "rejects invalid configuration before constructing adapters: %s %j",
  (id, overrides) => {
    expect(() =>
      LibrarySourcesModule.register({
        [id]: { ...LIBRARY_DEFINITIONS.nextjs, ...overrides },
      }),
    ).toThrow(`Invalid library definition: ${id}`);
    expect(fetch).not.toHaveBeenCalled();
  },
);

test("rejects an adapter whose library ID differs from its configuration key", async () => {
  const { Adapter } = fixtureAdapter();

  class WrongAdapter extends Adapter {
    constructor(...args) {
      super(...args);
      this.libraryId = "wrong";
    }
  }

  await expect(
    boot(
      LibrarySourcesModule.register({
        nextjs: { ...LIBRARY_DEFINITIONS.nextjs, adapter: WrongAdapter },
      }),
    ),
  ).rejects.toThrow("Adapter library ID does not match its definition: nextjs");
});

test("the complete MCP application boots with Next.js disabled and rejects every library tool", async () => {
  const script = `
    import 'reflect-metadata';
    import { NestFactory } from '@nestjs/core';
    import { Client } from '@modelcontextprotocol/client';
    import { InMemoryTransport } from '@modelcontextprotocol/server';
    const { LIBRARY_DEFINITIONS } = await import('./dist/modules/libraries/constants/library-definitions.constant.js');
    LIBRARY_DEFINITIONS.nextjs.enabled = false;
    const { AppModule } = await import('./dist/app.module.js');
    const { McpService } = await import('./dist/modules/mcp/mcp.service.js');
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('No HTTP expected'); };
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
    const server = app.get(McpService).createServer();
    const client = new Client({ name: 'disabled-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const libraries = await client.callTool({ name: 'list_libraries', arguments: {} });
      const errors = [];
      for (const [name, args] of [
        ['get_documentation', { path: 'app/guides/example' }],
        ['search_docs', { query: 'cache' }],
        ['list_versions', {}],
        ['get_code_examples', { query: 'cache' }],
      ]) {
        const result = await client.callTool({ name, arguments: { library: 'nextjs', ...args } });
        errors.push({ name, isError: result.isError, code: JSON.parse(result.content[0].text).code });
      }
      console.log(JSON.stringify({ libraries: libraries.structuredContent, errors, requests }));
    } finally {
      await client.close();
      await server.close();
      await app.close();
    }
  `;

  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      timeout: 10_000,
      env: { ...process.env, DOCUMENTATION_MCP_CACHE_ENABLED: "false" },
    },
  );
  const result = JSON.parse(stdout);

  expect(result.libraries).toEqual({ libraries: [] });
  expect(result.requests).toBe(0);
  expect(result.errors).toHaveLength(4);
  expect(
    result.errors.every(
      ({ isError, code }) => isError && code === "INVALID_REQUEST",
    ),
  ).toBe(true);
});

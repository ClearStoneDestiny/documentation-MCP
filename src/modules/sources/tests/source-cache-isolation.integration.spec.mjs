import "reflect-metadata";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { LibraryRegistry } from "../../../../dist/modules/libraries/library-registry.service.js";
import { LibrarySourcesModule } from "../../../../dist/modules/sources/library-sources.module.js";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";
import { VersionService } from "../../../../dist/modules/libraries/version.service.js";
import { DocumentationService } from "../../../../dist/modules/documentation/documentation.service.js";
import { SearchService } from "../../../../dist/modules/search/search.service.js";
import { CodeExamplesService } from "../../../../dist/modules/code-examples/code-examples.service.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("Nest scopes real adapters' catalogs and pages even when all source URLs are identical", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "documentation-mcp-scoped-sources-"),
  );

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  vi.stubEnv("DOCUMENTATION_MCP_CACHE_DIR", directory);
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_TTL_MS", "3600000");
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_ENABLED", "true");

  const documentationUrl = "https://shared.example/docs/";
  const catalogUrl = `${documentationUrl}llms.txt`;
  const path = "guide/shared";

  let pageRequest = 0;

  const fetchMock = vi.fn(
    async (url) =>
      new Response(
        url === catalogUrl
          ? `# Docs\n\n- [Shared](${documentationUrl}${path})`
          : `# Copy ${++pageRequest}\n\nSeparate saved content.`,
        {
          headers: {
            "Content-Type": "text/markdown",
            ETag: `"request-${fetchMock.mock.calls.length}"`,
          },
        },
      ),
  );

  vi.stubGlobal("fetch", fetchMock);

  const definitions = Object.fromEntries(
    ["alpha", "beta"].map((id) => [
      id,
      {
        enabled: true,
        name: id,
        documentationUrl,
        sources: { catalog: { format: "llms-txt", url: catalogUrl } },
        adapter: NextjsAdapter,
      },
    ]),
  );

  const apps = new Set();

  onTestFinished(async () => {
    for (const app of apps) await app.close();
  });

  async function boot() {
    class TestModule {}
    Module({
      imports: [LibrarySourcesModule.register(definitions)],
      providers: [LibraryRegistry],
    })(TestModule);

    const app = await NestFactory.createApplicationContext(TestModule, {
      logger: false,
      abortOnError: false,
    });
    apps.add(app);

    return app;
  }

  const firstApp = await boot();
  const registry = firstApp.get(LibraryRegistry);

  for (const [index, id] of ["alpha", "beta"].entries()) {
    const { adapter } = registry.get(id);

    expect((await adapter.fetchCatalog()).cache.status).toBe("miss");

    const document = await adapter.fetchDocument(path);

    expect(document.libraryId).toBe(id);
    expect(document.content).toContain(`Copy ${index + 1}`);
    expect(document.cache.status).toBe("miss");
  }

  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(
    fetchMock.mock.calls.every(
      ([, init]) => !init.headers.has("If-None-Match"),
    ),
  ).toBe(true);
  expect(await readdir(join(directory, "v2"))).toHaveLength(4);

  await firstApp.close();
  apps.delete(firstApp);

  fetchMock.mockImplementation(() => {
    throw new Error("Fresh scoped cache must survive restart");
  });

  const restarted = await boot();

  for (const [index, id] of ["alpha", "beta"].entries()) {
    const { adapter } = restarted.get(LibraryRegistry).get(id);

    expect((await adapter.fetchCatalog()).cache.status).toBe("hit");

    const document = await adapter.fetchDocument(path);

    expect(document.content).toContain(`Copy ${index + 1}`);
    expect(document.cache.status).toBe("hit");
  }

  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test("catalog version changes remain metadata while documents, indexes, and cache use current", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "documentation-mcp-set-identity-"),
  );

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  vi.stubEnv("DOCUMENTATION_MCP_CACHE_DIR", directory);
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_TTL_MS", "3600000");
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_ENABLED", "true");

  const documentationUrl = "https://nextjs.example/docs/";
  const catalogUrl = `${documentationUrl}llms.txt`;
  const path = "guide/cache";

  let declaredVersion = "1.0.0";

  const fetchMock = vi.fn(
    async (url) =>
      new Response(
        url === catalogUrl
          ? `# Next\n\n@doc-version: ${declaredVersion}\n\n- [Cache](${documentationUrl}${path})`
          : "# Cache\n\n## Refresh\n\nRefresh data.\n\n```ts\nrefresh()\n```",
        { headers: { "Content-Type": "text/markdown" } },
      ),
  );

  vi.stubGlobal("fetch", fetchMock);

  class TestModule {}
  Module({
    imports: [
      LibrarySourcesModule.register({
        nextjs: {
          enabled: true,
          name: "Custom Next",
          documentationUrl,
          sources: { catalog: { format: "llms-txt", url: catalogUrl } },
          adapter: NextjsAdapter,
        },
      }),
    ],

    providers: [
      LibraryRegistry,
      VersionService,
      DocumentationService,
      SearchService,
      CodeExamplesService,
    ],
  })(TestModule);

  const app = await NestFactory.createApplicationContext(TestModule, {
    logger: false,
    abortOnError: false,
  });

  onTestFinished(() => app.close());

  const versions = app.get(VersionService);
  const documentation = app.get(DocumentationService);
  const search = app.get(SearchService);
  const examples = app.get(CodeExamplesService);
  const firstSet = (await versions.listVersion({ library: "nextjs" }))
    .documentationSets[0];

  expect(firstSet).toMatchObject({
    id: "current",
    label: "Current Custom Next documentation",
    declaredVersion: "1.0.0",
    versionRange: null,
  });

  const firstDocument = await documentation.getDocumentation({
    library: "nextjs",
    path,
  });
  const firstSearch = await search.searchDocs({
    library: "nextjs",
    query: "refresh",
  });

  await examples.getCodeExamples({ library: "nextjs", query: "refresh" });
  expect(fetchMock).toHaveBeenCalledTimes(2);

  declaredVersion = "2.0.0";
  const nextSet = (
    await versions.listVersion({ library: "nextjs", refresh: true })
  ).documentationSets[0];

  expect(nextSet).toEqual({ ...firstSet, declaredVersion: "2.0.0" });

  const nextDocument = await documentation.getDocumentation({
    library: "nextjs",
    path,
  });
  expect(nextDocument.contentHash).toBe(firstDocument.contentHash);
  expect(nextDocument.cache.status).toBe("hit");

  const nextSearch = await search.searchDocs({
    library: "nextjs",
    query: "refresh",
  });

  expect(nextSearch.channel).toBe("current");
  expect(nextSearch.coverage.docVersion).toBe("2.0.0");
  expect(nextSearch.results[0].contentHash).toBe(
    firstSearch.results[0].contentHash,
  );

  const nextExamples = await examples.getCodeExamples({
    library: "nextjs",
    query: "refresh",
  });

  expect(nextExamples.version).toBe("current");
  expect(nextExamples.coverage.docVersion).toBe("2.0.0");

  await expect(
    examples.getCodeExamples({
      library: "nextjs",
      query: "refresh",
      version: "2.0.0",
    }),
  ).rejects.toMatchObject({ code: "VERSION_UNAVAILABLE" });

  expect(fetchMock).toHaveBeenCalledTimes(3);

  const files = await readdir(join(directory, "v2"));
  expect(files).toHaveLength(2);

  for (const file of files) {
    const entry = JSON.parse(
      await readFile(join(directory, "v2", file), "utf8"),
    );

    expect(entry.documentationSetId).toBe("current");
  }

  expect(
    app.get(LibraryRegistry).get("nextjs").capabilities.historicalDocumentation,
  ).toBe(false);
});

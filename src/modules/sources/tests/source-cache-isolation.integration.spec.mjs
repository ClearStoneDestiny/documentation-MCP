import "reflect-metadata";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { LibraryRegistry } from "../../../../dist/modules/libraries/library-registry.service.js";
import { LibrarySourcesModule } from "../../../../dist/modules/sources/library-sources.module.js";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";

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

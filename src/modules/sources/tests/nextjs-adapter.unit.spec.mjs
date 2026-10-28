import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";
import { CachedMarkdownService } from "../../../../dist/modules/sources/services/cached-markdown.service.js";
import { FileCacheService } from "../../../../dist/modules/cache/file-cache.service.js";
import { nextjsSourceOptions } from "../../libraries/tests/fixtures/library.fixture.mjs";

function createAdapter() {
  const store = new FileCacheService({
    directory: process.cwd(),
    ttlMs: 0,
    enabled: false,
  });

  return new NextjsAdapter(
    new CachedMarkdownService(store),
    nextjsSourceOptions,
  );
}

const path = "app/getting-started/caching";
const markdown =
  "# Example documentation\n\n## Example\n\n```ts\nconst value = 42;\n```\n";
const catalogFixture = readFileSync(
  new URL("./fixtures/nextjs-llms.txt", import.meta.url),
  "utf8",
);

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each(["text/markdown; charset=utf-8", "text/plain"])(
  "loads Markdown with content type %s and preserves code",
  async (contentType) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(markdown, {
        headers: { "Content-Type": contentType },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const document = await createAdapter().fetchDocument(path);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://nextjs.org/docs/app/getting-started/caching.md",
    );
    expect(document).toEqual({
      libraryId: "nextjs",
      path,
      sourceUrl: "https://nextjs.org/docs/app/getting-started/caching",
      content: markdown,
      format: "markdown",
      fetchedAt: expect.any(String),
      cache: {
        status: "disabled",
        checkedAt: expect.any(String),
        persisted: false,
      },
    });
    expect(Number.isNaN(Date.parse(document.fetchedAt))).toBe(false);
  },
);

test.each([
  "https://example.com/docs",
  "../package.json",
  "app/../secret",
  "app/%2e%2e/secret",
  "app/caching?version=old",
])(
  "rejects invalid document path %s before making a request",
  async (invalidPath) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAdapter().fetchDocument(invalidPath)).rejects.toThrow(
      "Invalid Next.js documentation path",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test.each([404, 429, 503])(
  "reports HTTP %s instead of returning an error page as documentation",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Error", { status })),
    );

    await expect(createAdapter().fetchDocument(path)).rejects.toThrow(
      `(${status})`,
    );
  },
);

test("rejects an HTML response instead of treating it as Markdown", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("<html>Error</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    ),
  );

  await expect(createAdapter().fetchDocument(path)).rejects.toThrow(
    "Expected Markdown",
  );
});

test("rejects an empty document", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(" \n ", {
        headers: { "Content-Type": "text/markdown" },
      }),
    ),
  );

  await expect(createAdapter().fetchDocument(path)).rejects.toThrow(
    "Empty documentation",
  );
});

test("forwards caller cancellation to the request", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    ),
  );

  const request = createAdapter().fetchDocument(path, controller.signal);
  const assertion = expect(request).rejects.toThrow("Request cancelled");
  controller.abort(new Error("Request cancelled"));

  await assertion;
});

test("fetches the catalog in one request and can load a discovered document", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(catalogFixture, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(markdown, {
        headers: { "Content-Type": "text/markdown" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const adapter = createAdapter();
  const catalog = await adapter.fetchCatalog();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("https://nextjs.org/docs/llms.txt");
  expect(catalog).toMatchObject({
    libraryId: "nextjs",
    sourceUrl: "https://nextjs.org/docs/llms.txt",
    docVersion: "99.1.0",
  });
  expect(Number.isNaN(Date.parse(catalog.fetchedAt))).toBe(false);
  expect(catalog.documents).toHaveLength(5);

  const reference = catalog.documents.find(
    (document) => document.title === "Caching",
  );
  const document = await adapter.fetchDocument(reference.path);

  expect(fetchMock.mock.calls[1][0]).toBe(`${reference.sourceUrl}.md`);
  expect(document.sourceUrl).toBe(reference.sourceUrl);
  expect(document.content).toBe(markdown);
});

test.each([
  "app/api-reference/functions/cacheLife",
  "app/api-reference/functions/unstable_cache",
])(
  "accepts the official API path %s when fetching a document",
  async (apiPath) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(markdown, {
        headers: { "Content-Type": "text/markdown" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const document = await createAdapter().fetchDocument(apiPath);

    expect(document.path).toBe(apiPath);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://nextjs.org/docs/${apiPath}.md`,
    );
  },
);

test.each([
  {
    status: 503,
    contentType: "text/plain",
    body: "Unavailable",
    error: "(503)",
  },
  {
    status: 200,
    contentType: "text/html",
    body: "<html>Error</html>",
    error: "Expected Markdown",
  },
  {
    status: 200,
    contentType: "text/plain",
    body: " \n ",
    error: "Empty documentation",
  },
  {
    status: 200,
    contentType: "text/plain",
    body: "# No document links",
    error: "No documentation entries found",
  },
])(
  "rejects an unusable catalog: $error",
  async ({ status, contentType, body, error }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status,
          headers: { "Content-Type": contentType },
        }),
      ),
    );

    await expect(createAdapter().fetchCatalog()).rejects.toThrow(error);
  },
);

test("forwards caller cancellation when fetching the catalog", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    ),
  );

  const request = createAdapter().fetchCatalog(controller.signal);
  const assertion = expect(request).rejects.toThrow(
    "Catalog request cancelled",
  );

  controller.abort(new Error("Catalog request cancelled"));

  await assertion;
});

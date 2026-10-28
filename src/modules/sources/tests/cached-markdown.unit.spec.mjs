import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { FileCacheService } from "../../../../dist/modules/cache/file-cache.service.js";
import { CachedMarkdownService } from "../../../../dist/modules/sources/services/cached-markdown.service.js";

const url = "https://nextjs.org/docs/app/guides/example.md";
const body = "# Example\n\nOriginal documentation.";
const changed = "# Example\n\nUpdated documentation.";
const modified = "Mon, 26 Oct 2026 10:00:00 GMT";
const scope = { libraryId: "nextjs", documentationSetId: "current" };
const key = { ...scope, url };

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup(ttlMs = 1000) {
  const directory = await mkdtemp(join(tmpdir(), "documentation-mcp-http-"));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const options = { directory, ttlMs, enabled: true };
  const store = new FileCacheService(options);

  return {
    store,
    options,
    directory,
    loader: new CachedMarkdownService(store, scope),
  };
}

function markdown(content = body, headers = {}) {
  return new Response(content, {
    headers: { "Content-Type": "text/markdown", ...headers },
  });
}

test("uses a fresh disk entry across loader instances without HTTP and preserves fetchedAt", async () => {
  const { loader, options } = await setup();
  const fetchMock = vi.fn(async () => markdown(body, { ETag: '"v1"' }));

  vi.stubGlobal("fetch", fetchMock);

  const first = await loader.load(url);
  const second = await new CachedMarkdownService(
    new FileCacheService(options),
    scope,
  ).load(url);

  expect(first.cache).toMatchObject({ status: "miss", persisted: true });
  expect(second.cache).toMatchObject({
    status: "hit",
    persisted: true,
    checkedAt: first.cache.checkedAt,
  });
  expect(second.fetchedAt).toBe(first.fetchedAt);
  expect(second.content).toBe(body);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("expires by TTL, sends ETag, and handles bodyless 304 without changing fetchedAt", async () => {
  const { loader, store } = await setup();

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      markdown(body, { ETag: '"v1"', "Last-Modified": modified }),
    )
    .mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { ETag: '"v1b"' } }),
    );

  vi.stubGlobal("fetch", fetchMock);
  const first = await loader.load(url);

  vi.setSystemTime(new Date("2026-10-26T10:00:02Z"));
  const second = await loader.load(url);

  const headers = fetchMock.mock.calls[1][1].headers;

  expect(headers.get("if-none-match")).toBe('"v1"');
  expect(headers.has("if-modified-since")).toBe(false);
  expect(second.fetchedAt).toBe(first.fetchedAt);
  expect(second.cache).toMatchObject({
    status: "revalidated",
    checkedAt: "2026-10-26T10:00:02.000Z",
  });
  expect((await store.read(key)).etag).toBe('"v1b"');
  expect((await loader.load(url)).cache.status).toBe("hit");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("uses Last-Modified when ETag is unavailable", async () => {
  const { loader } = await setup(0);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(markdown(body, { "Last-Modified": modified }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }));

  vi.stubGlobal("fetch", fetchMock);

  await loader.load(url);
  await loader.load(url);

  expect(fetchMock.mock.calls[1][1].headers.get("if-modified-since")).toBe(
    modified,
  );
});

test("refresh checks even a fresh entry and replaces changed content and old validators", async () => {
  const { loader, store } = await setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(markdown(body, { ETag: '"v1"' }))
    .mockResolvedValueOnce(markdown(changed))
    .mockResolvedValueOnce(markdown(changed));

  vi.stubGlobal("fetch", fetchMock);

  await loader.load(url);
  const updated = await loader.load(url, undefined, { refresh: true });

  expect(updated.content).toBe(changed);
  expect(updated.cache.status).toBe("updated");
  expect((await store.read(key)).etag).toBeUndefined();
  expect((await loader.load(url)).content).toBe(changed);

  await loader.load(url, undefined, { refresh: true });

  expect(fetchMock.mock.calls[2][1].headers.has("if-none-match")).toBe(false);
});

test.each(["network", "timeout", 429, 503])(
  "returns an explicitly stale copy on temporary failure %s",
  async (failure) => {
    const { loader, store } = await setup(0);
    const fetchMock = vi.fn().mockResolvedValueOnce(markdown());

    vi.stubGlobal("fetch", fetchMock);

    const first = await loader.load(url);

    if (failure === "network") {
      fetchMock.mockRejectedValue(new TypeError("Offline"));
    } else if (failure === "timeout") {
      fetchMock.mockRejectedValue(
        new DOMException("Timed out", "TimeoutError"),
      );
    } else {
      fetchMock.mockImplementation(
        async () => new Response("Unavailable", { status: failure }),
      );
    }

    const stale = await loader.load(url);

    expect(stale.content).toBe(body);
    expect(stale.fetchedAt).toBe(first.fetchedAt);
    expect(stale.cache).toMatchObject({
      status: "stale",
      checkedAt: first.cache.checkedAt,
      warning: expect.any(String),
    });
    expect((await store.read(key)).checkedAt).toBe(first.cache.checkedAt);

    await loader.load(url);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  },
);

test.each([302, 308, 401, 403, 404, 410])(
  "does not mask HTTP %s with a stale success",
  async (status) => {
    const { loader, store } = await setup(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(markdown())
      .mockImplementation(async () => new Response("Error", { status }));

    vi.stubGlobal("fetch", fetchMock);

    await loader.load(url);
    await expect(loader.load(url)).rejects.toThrow(`(${status})`);

    if (status === 404 || status === 410) {
      {
        expect(await store.read(key)).toBeNull();
      }
    }
  },
);

test.each(["html", "empty"])(
  "does not store an invalid %s response or hide it behind stale content",
  async (kind) => {
    const { loader, store } = await setup(0);
    const invalid =
      kind === "html"
        ? new Response("<html>Error</html>", {
            headers: { "Content-Type": "text/html" },
          })
        : markdown(" \n ");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(markdown()).mockResolvedValueOnce(invalid),
    );

    await loader.load(url);
    await expect(loader.load(url)).rejects.toThrow();

    expect((await store.read(key)).content).toBe(body);
  },
);

test("honors cancellation during revalidation instead of returning stale content", async () => {
  const { loader } = await setup(0);
  const fetchMock = vi.fn().mockResolvedValueOnce(markdown());

  vi.stubGlobal("fetch", fetchMock);

  await loader.load(url);

  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  fetchMock.mockImplementation(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        markStarted();
      }),
  );

  const controller = new AbortController();

  const reason = new Error("User cancelled");
  const pending = loader.load(url, controller.signal);
  const assertion = expect(pending).rejects.toBe(reason);

  await started;
  controller.abort(reason);
  await assertion;
});

test("reports network errors and unexpected 304 when there is no cached copy", async () => {
  const { loader } = await setup();

  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));

  await expect(loader.load(url)).rejects.toThrow("Offline");

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 304 })),
  );

  await expect(loader.load(url)).rejects.toThrow("Unexpected HTTP 304");
});

test.each([200, 304])(
  "honors no-store on HTTP %s and removes an old saved copy",
  async (status) => {
    const { loader, store } = await setup();
    const next =
      status === 304
        ? new Response(null, {
            status,
            headers: { "Cache-Control": "no-store" },
          })
        : markdown(changed, { "Cache-Control": "no-store" });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(markdown(body, { ETag: '"v1"' }))
        .mockResolvedValueOnce(next),
    );

    await loader.load(url);
    const result = await loader.load(url, undefined, { refresh: true });

    expect(result.cache).toMatchObject({
      status: "disabled",
      persisted: false,
    });
    expect(await store.read(key)).toBeNull();
  },
);

test("still serves the online document if its cache cannot be written", async () => {
  const { directory } = await setup();
  const blocked = join(directory, "blocked");

  await writeFile(blocked, "file");

  const loader = new CachedMarkdownService(
    new FileCacheService({ directory: blocked, ttlMs: 1000, enabled: true }),
    scope,
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => markdown()),
  );

  const result = await loader.load(url);

  expect(result.content).toBe(body);
  expect(result.cache).toMatchObject({
    persisted: false,
    warning: expect.any(String),
  });
});

test("content, validators, and stale fallback are isolated for the same URL in different scopes", async () => {
  const { store, options } = await setup();
  const scopes = [
    scope,
    { ...scope, libraryId: "other" },
    { ...scope, documentationSetId: "release-1" },
  ];
  const loaders = scopes.map(
    (candidate) => new CachedMarkdownService(store, candidate),
  );
  const fetchMock = vi.fn();
  for (let index = 0; index < scopes.length; index++) {
    fetchMock.mockResolvedValueOnce(
      markdown(`# Scope ${index}`, { ETag: `"scope-${index}"` }),
    );
  }
  vi.stubGlobal("fetch", fetchMock);

  for (let index = 0; index < loaders.length; index++) {
    const first = await loaders[index].load(url);
    expect(first.cache.status).toBe("miss");
    expect(first.content).toBe(`# Scope ${index}`);
    expect(fetchMock.mock.calls[index][1].headers.has("If-None-Match")).toBe(
      false,
    );
  }

  for (let index = 0; index < scopes.length; index++) {
    const restarted = new CachedMarkdownService(
      new FileCacheService(options),
      scopes[index],
    );
    expect((await restarted.load(url)).content).toBe(`# Scope ${index}`);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    const result = await restarted.load(url, undefined, { refresh: true });
    expect(result.cache.status).toBe("revalidated");
    expect(fetchMock.mock.lastCall[1].headers.get("If-None-Match")).toBe(
      `"scope-${index}"`,
    );
  }
  expect(fetchMock).toHaveBeenCalledTimes(6);

  fetchMock.mockRejectedValue(new TypeError("Offline"));
  for (let index = 0; index < loaders.length; index++) {
    const stale = await loaders[index].load(url, undefined, { refresh: true });
    expect(stale.cache.status).toBe("stale");
    expect(stale.content).toBe(`# Scope ${index}`);
  }
  const uncached = new CachedMarkdownService(store, {
    ...scope,
    libraryId: "uncached",
  });
  await expect(uncached.load(url)).rejects.toThrow("Offline");
});

test.each(["no-store-200", "no-store-304", 404, 410])(
  "%s removes only the current scope's saved entry",
  async (outcome) => {
    const { store } = await setup();
    const otherScope = { ...scope, libraryId: "other" };
    const first = new CachedMarkdownService(store, scope);
    const other = new CachedMarkdownService(store, otherScope);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(markdown(body, { ETag: '"first"' }))
      .mockResolvedValueOnce(markdown(changed, { ETag: '"other"' }));
    vi.stubGlobal("fetch", fetchMock);
    await first.load(url);
    await other.load(url);

    const status =
      typeof outcome === "number"
        ? outcome
        : outcome.endsWith("304")
          ? 304
          : 200;
    fetchMock.mockResolvedValueOnce(
      new Response(status === 304 ? null : body, {
        status,
        headers: {
          "Content-Type": "text/markdown",
          "Cache-Control": "no-store",
        },
      }),
    );
    const request = first.load(url, undefined, { refresh: true });
    if (typeof outcome === "number")
      await expect(request).rejects.toThrow(`(${status})`);
    else expect((await request).cache.status).toBe("disabled");

    expect(await store.read(key)).toBeNull();
    expect((await store.read({ ...otherScope, url })).etag).toBe('"other"');
    const unaffected = await other.load(url);
    expect(unaffected.cache.status).toBe("hit");
    expect(unaffected.content).toBe(changed);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  },
);

test("requires an explicit cache scope and snapshots it at construction", async () => {
  const { store } = await setup();
  expect(() => new CachedMarkdownService(store)).toThrow();
  expect(
    () =>
      new CachedMarkdownService(store, {
        libraryId: "nextjs",
        documentationSetId: "",
      }),
  ).toThrow();
  const mutable = { ...scope };
  const loader = new CachedMarkdownService(store, mutable);
  mutable.libraryId = "other";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => markdown()),
  );
  await loader.load(url);
  expect((await store.read(key)).content).toBe(body);
  expect(await store.read({ ...mutable, url })).toBeNull();
});

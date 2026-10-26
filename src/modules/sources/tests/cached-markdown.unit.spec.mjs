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
    loader: new CachedMarkdownService(store),
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
  expect((await store.read(url)).etag).toBe('"v1b"');
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
  expect((await store.read(url)).etag).toBeUndefined();
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
    expect((await store.read(url)).checkedAt).toBe(first.cache.checkedAt);

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
        expect(await store.read(url)).toBeNull();
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

    expect((await store.read(url)).content).toBe(body);
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
    expect(await store.read(url)).toBeNull();
  },
);

test("still serves the online document if its cache cannot be written", async () => {
  const { directory } = await setup();
  const blocked = join(directory, "blocked");

  await writeFile(blocked, "file");

  const loader = new CachedMarkdownService(
    new FileCacheService({ directory: blocked, ttlMs: 1000, enabled: true }),
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

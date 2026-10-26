import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
import {
  contentHash,
  FileCacheService,
} from "../../../../dist/modules/cache/file-cache.service.js";
import { readCacheOptions } from "../../../../dist/modules/cache/cache.config.js";

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "documentation-mcp-store-"));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const options = { directory, ttlMs: 3_600_000, enabled: true };
  const url = "https://nextjs.org/docs/app/guides/example.md";
  const entry = {
    schemaVersion: 1,
    url,
    content: "# Example\n\nBody.",
    contentHash: contentHash("# Example\n\nBody."),
    fetchedAt: "2026-10-26T10:00:00.000Z",
    checkedAt: "2026-10-26T10:00:00.000Z",
    etag: '"v1"',
    lastModified: "Mon, 26 Oct 2026 10:00:00 GMT",
  };

  return {
    store: new FileCacheService(options),
    options,
    entry,
    directory,
    file: join(directory, "v1", `${contentHash(url)}.json`),
  };
}

test("persists content and validators across store instances with URL-hashed filenames", async () => {
  const { store, options, entry, directory } = await setup();

  expect(await store.write(entry)).toBe(true);
  expect(await new FileCacheService(options).read(entry.url)).toEqual(entry);
  expect(await readdir(join(directory, "v1"))).toEqual([
    `${contentHash(entry.url)}.json`,
  ]);
});

test.each(["invalid-json", "wrong-hash", "wrong-url", "future-schema"])(
  "ignores corrupt or incompatible cache records: %s",
  async (kind) => {
    const { store, entry, file } = await setup();
    await store.write(entry);
    const invalid = { ...entry };

    if (kind === "wrong-hash") {
      invalid.content += "Tampered";
    }

    if (kind === "wrong-url") {
      invalid.url = "https://example.com/other";
    }

    if (kind === "future-schema") {
      invalid.schemaVersion = 2;
    }

    await writeFile(
      file,
      kind === "invalid-json" ? "{partial" : JSON.stringify(invalid),
    );

    expect(await store.read(entry.url)).toBeNull();
    expect(console.error).toHaveBeenCalled();
    expect(await store.write(entry)).toBe(true);
    expect(await store.read(entry.url)).toEqual(entry);
  },
);

test("concurrent writes leave one complete record and no temporary files", async () => {
  const { store, entry, directory } = await setup();
  const entries = Array.from({ length: 8 }, (_, index) => {
    const content = `# Version ${index}\n${"Text".repeat(100)}`;
    return { ...entry, content, contentHash: contentHash(content) };
  });

  expect(
    await Promise.all(entries.map((candidate) => store.write(candidate))),
  ).toEqual(Array(8).fill(true));
  expect(entries).toContainEqual(await store.read(entry.url));
  expect(await readdir(join(directory, "v1"))).toHaveLength(1);
});

test("handles missing entries and an unusable directory without breaking callers", async () => {
  const { store, entry, directory } = await setup();

  expect(await store.read(entry.url)).toBeNull();

  const blocked = join(directory, "blocked");
  await writeFile(blocked, "This is a file");

  const broken = new FileCacheService({
    directory: blocked,
    ttlMs: 1000,
    enabled: true,
  });

  expect(await broken.write(entry)).toBe(false);
  expect(await broken.read(entry.url)).toBeNull();
  expect(await readFile(blocked, "utf8")).toBe("This is a file");
});

test("disabled caching does not create files", async () => {
  const { options, entry, directory } = await setup();
  const store = new FileCacheService({ ...options, enabled: false });

  expect(await store.write(entry)).toBe(false);
  expect(await store.read(entry.url)).toBeNull();
  expect(await readdir(directory)).toEqual([]);
});

test("reads explicit environment settings", () => {
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_DIR", "/tmp/custom-documentation-cache");
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_TTL_MS", "5000");
  vi.stubEnv("DOCUMENTATION_MCP_CACHE_ENABLED", "false");

  expect(readCacheOptions()).toEqual({
    directory: "/tmp/custom-documentation-cache",
    ttlMs: 5000,
    enabled: false,
  });
});

test.each([-1, 1.5, NaN, Infinity])("rejects invalid TTL %s", (ttlMs) => {
  expect(
    () => new FileCacheService({ directory: tmpdir(), ttlMs, enabled: true }),
  ).toThrow("Invalid cache configuration");
});

import { expect, test, vi } from "vitest";
import { VersionService } from "../../../../dist/modules/libraries/version.service.js";
import { createRegistry } from "./fixtures/library.fixture.mjs";

const request = { library: "nextjs" };

function setup() {
  const sets = {
    documentationSets: [
      {
        id: "current",
        label: "Live handbook",
        channel: "current",
        declaredVersion: "99.1.0",
        versionRange: null,
        sourceUrl: "https://example.com/handbook/",
      },
    ],
    catalog: {
      sourceUrl: "https://example.com/catalog.txt",
      fetchedAt: "2026-10-28T10:00:00.000Z",
    },
  };
  const adapter = {
    libraryId: "nextjs",
    listDocumentationSets: vi.fn().mockResolvedValue(sets),
  };
  return {
    sets,
    adapter,
    service: new VersionService(createRegistry(adapter)),
  };
}

test("delegates labels, URLs, and metadata to set discovery and defaults refresh to false", async () => {
  const { sets, adapter, service } = setup();
  const result = await service.listVersion(request);

  expect(adapter.listDocumentationSets).toHaveBeenCalledExactlyOnceWith(
    undefined,
    {
      refresh: false,
    },
  );
  expect(result).toEqual({ library: "nextjs", ...sets });
});

test("forwards refresh and the caller signal to set discovery", async () => {
  const { adapter, service } = setup();
  const controller = new AbortController();

  await service.listVersion({ ...request, refresh: true }, controller.signal);

  expect(adapter.listDocumentationSets).toHaveBeenCalledExactlyOnceWith(
    controller.signal,
    { refresh: true },
  );
});

test("preserves cache metadata and represents an unavailable version as null", async () => {
  const { sets, service } = setup();

  sets.documentationSets[0].declaredVersion = null;

  sets.catalog.cache = {
    status: "stale",
    checkedAt: sets.catalog.fetchedAt,
    persisted: true,
    warning: "Source is offline; serving the saved copy.",
  };

  const result = await service.listVersion(request);

  expect(result.documentationSets[0]).toMatchObject({
    declaredVersion: null,
    versionRange: null,
  });
  expect(result.catalog.cache).toEqual(sets.catalog.cache);
});

test.each([
  {},
  { library: "react" },
  { ...request, version: "14" },
  { ...request, refresh: "true" },
])("rejects invalid input before discovering sets: %j", async (input) => {
  const { adapter, service } = setup();

  await expect(service.listVersion(input)).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  expect(adapter.listDocumentationSets).not.toHaveBeenCalled();
});

test.each([
  [new Error("HTTP 503"), "HTTP 503"],
  ["Unavailable", "Request failed"],
])(
  "wraps source failure %j and preserves its cause",
  async (cause, message) => {
    const { adapter, service } = setup();
    adapter.listDocumentationSets.mockRejectedValue(cause);

    await expect(service.listVersion(request)).rejects.toMatchObject({
      name: "DocumentationError",
      code: "SOURCE_ERROR",
      message,
      cause,
    });
  },
);

test("honors an already aborted signal before discovering sets", async () => {
  const { adapter, service } = setup();
  const reason = new Error("Cancelled by caller");
  const controller = new AbortController();

  controller.abort(reason);

  await expect(service.listVersion(request, controller.signal)).rejects.toBe(
    reason,
  );

  expect(adapter.listDocumentationSets).not.toHaveBeenCalled();
});

test.each([false, true])(
  "preserves cancellation when set discovery finishes (rejects: %s)",
  async (rejects) => {
    const { sets, adapter, service } = setup();
    const controller = new AbortController();
    const reason = new Error("Cancelled during catalog fetch");

    adapter.listDocumentationSets.mockImplementation(async () => {
      controller.abort(reason);

      if (rejects) {
        throw new Error("Source interrupted");
      }

      return sets;
    });

    await expect(service.listVersion(request, controller.signal)).rejects.toBe(
      reason,
    );
  },
);

test("static set discovery works without any catalog or document loader", async () => {
  const { sets, service } = setup();

  delete sets.catalog;

  expect(await service.listVersion(request)).toEqual({
    library: "nextjs",
    documentationSets: sets.documentationSets,
  });
});

test("does not infer compatibility or set IDs from declared version metadata", async () => {
  const { sets, service } = setup();
  sets.documentationSets[0].declaredVersion = "^19.0.0";

  const result = await service.listVersion(request);

  expect(result.documentationSets[0]).toMatchObject({
    id: "current",
    declaredVersion: "^19.0.0",
    versionRange: null,
  });
});

test.each([
  undefined,
  {},
  { documentationSets: "current" },
  { documentationSets: [{ id: "current" }] },
])(
  "rejects malformed discovery results as SOURCE_ERROR: %j",
  async (result) => {
    const { adapter, service } = setup();
    adapter.listDocumentationSets.mockResolvedValue(result);

    await expect(service.listVersion(request)).rejects.toMatchObject({
      code: "SOURCE_ERROR",
    });
  },
);

test.each([
  { id: "99.1.0" },
  { id: "v14", channel: "versioned" },
  { channel: "versioned" },
  { declaredVersion: 99 },
  { sourceUrl: "not-a-url" },
])("rejects invalid or unselectable set metadata: %j", async (overrides) => {
  const { sets, service } = setup();

  Object.assign(sets.documentationSets[0], overrides);

  await expect(service.listVersion(request)).rejects.toMatchObject({
    code: "SOURCE_ERROR",
  });
});

test("rejects duplicate set IDs instead of exposing ambiguous selections", async () => {
  const { sets, service } = setup();
  sets.documentationSets.push({ ...sets.documentationSets[0] });

  await expect(service.listVersion(request)).rejects.toMatchObject({
    code: "SOURCE_ERROR",
  });
});

test("supports an empty available-set result without fabricating current", async () => {
  const { sets, service } = setup();
  sets.documentationSets = [];

  delete sets.catalog;
  
  expect(await service.listVersion(request)).toEqual({
    library: "nextjs",
    documentationSets: [],
  });
});

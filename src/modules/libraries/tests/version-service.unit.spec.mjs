import { expect, test, vi } from "vitest";
import { VersionService } from "../../../../dist/modules/libraries/version.service.js";

const request = { library: "nextjs" };

function setup() {
  const catalog = {
    libraryId: "nextjs",
    sourceUrl: "https://nextjs.org/docs/llms.txt",
    fetchedAt: "2026-10-28T10:00:00.000Z",
    docVersion: "99.1.0",
    documents: [],
  };
  const adapter = { fetchCatalog: vi.fn().mockResolvedValue(catalog) };
  return { catalog, adapter, service: new VersionService(adapter) };
}

test("returns only the current documentation set and defaults refresh to false", async () => {
  const { catalog, adapter, service } = setup();
  const result = await service.listVersion(request);

  expect(adapter.fetchCatalog).toHaveBeenCalledExactlyOnceWith(undefined, {
    refresh: false,
  });
  expect(result).toEqual({
    library: "nextjs",
    documentationSets: [
      {
        id: "current",
        label: "Current Next.js documentation",
        channel: "current",
        declaredVersion: "99.1.0",
        versionRange: null,
        sourceUrl: "https://nextjs.org/docs/",
      },
    ],
    catalog: {
      sourceUrl: catalog.sourceUrl,
      fetchedAt: catalog.fetchedAt,
    },
  });
});

test("forwards refresh and the caller signal to the catalog adapter", async () => {
  const { adapter, service } = setup();
  const controller = new AbortController();

  await service.listVersion({ ...request, refresh: true }, controller.signal);

  expect(adapter.fetchCatalog).toHaveBeenCalledExactlyOnceWith(
    controller.signal,
    { refresh: true },
  );
});

test("preserves cache metadata and represents an unavailable version as null", async () => {
  const { catalog, service } = setup();

  delete catalog.docVersion;

  catalog.cache = {
    status: "stale",
    checkedAt: catalog.fetchedAt,
    persisted: true,
    warning: "Source is offline; serving the saved copy.",
  };

  const result = await service.listVersion(request);

  expect(result.documentationSets[0]).toMatchObject({
    declaredVersion: null,
    versionRange: null,
  });
  expect(result.catalog.cache).toEqual(catalog.cache);
});

test.each([
  {},
  { library: "react" },
  { ...request, version: "14" },
  { ...request, refresh: "true" },
])("rejects invalid input before fetching the catalog: %j", async (input) => {
  const { adapter, service } = setup();

  await expect(service.listVersion(input)).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  expect(adapter.fetchCatalog).not.toHaveBeenCalled();
});

test.each([
  [new Error("HTTP 503"), "HTTP 503"],
  ["Unavailable", "Request failed"],
])(
  "wraps source failure %j and preserves its cause",
  async (cause, message) => {
    const { adapter, service } = setup();
    adapter.fetchCatalog.mockRejectedValue(cause);

    await expect(service.listVersion(request)).rejects.toMatchObject({
      name: "DocumentationError",
      code: "SOURCE_ERROR",
      message,
      cause,
    });
  },
);

test("honors an already aborted signal before fetching the catalog", async () => {
  const { adapter, service } = setup();
  const reason = new Error("Cancelled by caller");
  const controller = new AbortController();

  controller.abort(reason);

  await expect(service.listVersion(request, controller.signal)).rejects.toBe(
    reason,
  );

  expect(adapter.fetchCatalog).not.toHaveBeenCalled();
});

test.each([false, true])(
  "preserves cancellation when the catalog request finishes (rejects: %s)",
  async (rejects) => {
    const { catalog, adapter, service } = setup();
    const controller = new AbortController();
    const reason = new Error("Cancelled during catalog fetch");

    adapter.fetchCatalog.mockImplementation(async () => {
      controller.abort(reason);
      
      if (rejects) {
        throw new Error("Source interrupted");
      }

      return catalog;
    });

    await expect(service.listVersion(request, controller.signal)).rejects.toBe(
      reason,
    );
  },
);

import { describe, expect, test, vi } from "vitest";
import { createRegistry } from "./fixtures/library.fixture.mjs";
import { LibraryService } from "../../../../dist/modules/libraries/library.service.js";

describe("LibraryService", () => {
  const nextjsLibrary = {
    id: "nextjs",
    name: "Next.js",
    documentationUrl: "https://nextjs.org/docs/",
    capabilities: {
      tools: [
        "get_documentation",
        "search_docs",
        "list_versions",
        "get_code_examples",
      ],
      historicalDocumentation: false,
    },
  };

  function setup() {
    const adapter = {
      libraryId: "nextjs",
      documentFormat: "markdown",
      isValidPath: vi.fn(() => true),
      fetchCatalog: vi.fn(),
      listDocumentationSets: vi.fn(),
      fetchDocument: vi.fn(),
    };
    const registry = createRegistry(adapter);
    const list = vi.spyOn(registry, "list");

    return { adapter, registry, list, service: new LibraryService(registry) };
  }

  test("lists supported libraries and their public capabilities without fetching documentation", () => {
    const { adapter, service } = setup();

    expect(service.listLibraries({})).toEqual({ libraries: [nextjsLibrary] });
    expect(adapter.fetchCatalog).not.toHaveBeenCalled();
    expect(adapter.listDocumentationSets).not.toHaveBeenCalled();
    expect(adapter.fetchDocument).not.toHaveBeenCalled();
  });

  test.each(["nextj", "NeXtJ", "xt.j", "NEXT.JS", "  Next.JS\t"])(
    "matches identifiers and display names by a trimmed case-insensitive substring: %j",
    (filter) => {
      const { service } = setup();

      expect(service.listLibraries({ filter })).toEqual({
        libraries: [nextjsLibrary],
      });
    },
  );

  test.each(["react", "next js", "x".repeat(100)])(
    "returns an empty successful result when no libraries match: %j",
    (filter) => {
      const { service } = setup();

      expect(service.listLibraries({ filter })).toEqual({ libraries: [] });
    },
  );

  test("handles an empty registry", () => {
    const { list, service } = setup();
    list.mockReturnValue([]);

    expect(service.listLibraries({})).toEqual({ libraries: [] });
  });

  test.each([
    { filter: "" },
    { filter: " \t\n" },
    { filter: "x".repeat(101) },
    { filter: null },
    { filter: 123 },
    { filter: true },
    { library: "nextjs" },
  ])("rejects invalid input before reading the registry: %j", (input) => {
    const { list, service } = setup();

    expect(() => service.listLibraries(input)).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(list).not.toHaveBeenCalled();
  });

  test("keeps registry metadata intact when a caller mutates a returned library", () => {
    const { registry, service } = setup();
    const result = service.listLibraries({});

    result.libraries[0].name = "Changed";
    result.libraries[0].capabilities.tools.pop();
    result.libraries[0].capabilities.historicalDocumentation = true;
    result.libraries.pop();

    expect(service.listLibraries({})).toEqual({ libraries: [nextjsLibrary] });
    expect(registry.get("nextjs")).toMatchObject(nextjsLibrary);
  });
});

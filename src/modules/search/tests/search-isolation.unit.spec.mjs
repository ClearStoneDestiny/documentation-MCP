import { describe, expect, onTestFinished, test, vi } from "vitest";
import { SearchService } from "../../../../dist/modules/search/search.service.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";
import { LibraryRegistry } from "../../../../dist/modules/libraries/library-registry.service.js";
import { createLibraryRegistration } from "../../../../dist/modules/libraries/utils/create-library-registration.util.js";
import { DocumentPipelineRegistry } from "../../../../dist/modules/documentation/document-pipeline-registry.service.js";
import { createMarkdownPipeline } from "../../../../dist/modules/documentation/pipelines/markdown.pipeline.js";

describe("SearchService", () => {
  const path = "guide/shared";
  const request = (library) => ({ library, query: "revalidation" });

  function setup(identical = false) {
    const contents = {
      alpha: {
        [path]: "# Alpha\n\nRevalidation alphakeyword.",
        "guide/extra": "# Extra\n\nRevalidation extra.",
      },

      beta: {
        [path]: identical
          ? "# Alpha\n\nRevalidation alphakeyword."
          : "# Beta\n\nRevalidation betakeyword.",
      },
    };

    const catalogs = {};
    const adapters = {};
    const parser = new MarkdownDocumentParser();

    vi.spyOn(parser, "parse");

    const pipelines = new DocumentPipelineRegistry([
      createMarkdownPipeline(parser),
    ]);

    const registrations = Object.entries(contents).map(
      ([libraryId, documents]) => {
        catalogs[libraryId] = {
          libraryId,
          sourceUrl: `https://${libraryId}.example/catalog.txt`,
          fetchedAt: "2026-10-28T10:00:00.000Z",
          documents: Object.keys(documents).map((documentPath) => ({
            path: documentPath,
            title: documentPath,
            sourceUrl: `https://${libraryId}.example/${documentPath}`,
          })),
        };

        const adapter = {
          libraryId,
          documentFormat: "markdown",
          isValidPath: () => true,
          fetchCatalog: vi.fn(async () => catalogs[libraryId]),
          fetchDocument: vi.fn(async (documentPath) => ({
            libraryId,
            path: documentPath,
            sourceUrl: `https://${libraryId}.example/${documentPath}`,
            content: contents[libraryId][documentPath],
            format: "markdown",
            fetchedAt: catalogs[libraryId].fetchedAt,
          })),
        };

        adapters[libraryId] = adapter;

        return createLibraryRegistration(
          libraryId,
          {
            enabled: true,
            name: libraryId,
            documentationUrl: `https://${libraryId}.example/`,
            sources: {},
            adapter: class {},
          },
          adapter,
          pipelines,
        );
      },
    );

    return {
      service: new SearchService(new LibraryRegistry(registrations)),
      parser,
      contents,
      catalogs,
      adapters,
    };
  }

  describe("index isolation between libraries", () => {
    test("equal paths and hashes get separate indexes and remain reusable after switching libraries", async () => {
      const { service, parser } = setup(true);

      const alpha = await service.searchDocs(request("alpha"));
      const beta = await service.searchDocs(request("beta"));

      expect(parser.parse).toHaveBeenCalledTimes(3);
      expect(alpha.results.map(({ path }) => path)).toContain("guide/extra");
      expect(beta.results.map(({ path }) => path)).toEqual([path]);
      expect(beta.results[0].getDocumentation.library).toBe("beta");

      await service.searchDocs(request("alpha"));
      await service.searchDocs(request("beta"));

      expect(parser.parse).toHaveBeenCalledTimes(3);
    });

    test("refreshing one library replaces only its own postings and hashes", async () => {
      const { service, parser, contents } = setup();

      await service.searchDocs(request("alpha"));

      const before = await service.searchDocs(request("beta"));

      parser.parse.mockClear();
      contents.alpha[path] = "# Changed\n\nReplacementkeyword.";

      const changed = await service.searchDocs({
        library: "alpha",
        query: "replacementkeyword",
        refresh: true,
      });

      expect(changed.results[0].title).toBe("Changed");
      expect(parser.parse).toHaveBeenCalledTimes(1);

      const beta = await service.searchDocs(request("beta"));

      expect(beta.results).toEqual(before.results);
      expect(parser.parse).toHaveBeenCalledTimes(1);
      expect(
        (
          await service.searchDocs({
            library: "beta",
            query: "replacementkeyword",
          })
        ).results,
      ).toEqual([]);
    });

    test.each(["removed", "fetch-failure", "parse-failure"])(
      "%s in one catalog does not evict another library's equal path",
      async (failure) => {
        const { service, parser, catalogs, adapters, contents } = setup();

        await service.searchDocs(request("alpha"));

        const before = await service.searchDocs(request("beta"));

        if (failure === "removed") {
          catalogs.alpha.documents = catalogs.alpha.documents.filter(
            (document) => document.path !== path,
          );
        } else if (failure === "parse-failure") {
          contents.alpha[path] = "---\ntitle: [invalid]\n---\n# Broken";
        } else {
          const original = adapters.alpha.fetchDocument.getMockImplementation();

          adapters.alpha.fetchDocument.mockImplementation(
            async (documentPath) => {
              if (documentPath === path) {
                throw new Error("Offline");
              }

              return original(documentPath);
            },
          );
        }
        const alpha = await service.searchDocs(request("alpha"));

        expect(alpha.results.map(({ path }) => path)).not.toContain(path);
        parser.parse.mockClear();

        const beta = await service.searchDocs(request("beta"));

        expect(beta.results).toEqual(before.results);
        expect(beta.coverage.failedDocuments).toBe(0);
        expect(parser.parse).not.toHaveBeenCalled();
      },
    );
  });

  describe("queue and cancellation isolation", () => {
    test("a busy library does not block another library, while its own queue remains cancellable", async () => {
      const { service, adapters } = setup();

      const started = Promise.withResolvers();
      const release = Promise.withResolvers();
      const original = adapters.alpha.fetchDocument.getMockImplementation();

      adapters.alpha.fetchDocument.mockImplementation(async (...args) => {
        started.resolve();
        await release.promise;
        return original(...args);
      });

      const active = service.searchDocs(request("alpha"));

      onTestFinished(async () => {
        release.resolve();
        await active;
      });
      await started.promise;

      const queued = new AbortController();
      const waiting = service.searchDocs(request("alpha"), queued.signal);
      const cancelled = expect(waiting).rejects.toThrow("Cancel queued alpha");

      queued.abort(new Error("Cancel queued alpha"));
      await cancelled;

      expect(adapters.alpha.fetchCatalog).toHaveBeenCalledTimes(1);

      const independent = service.searchDocs(request("beta"));

      await vi.waitFor(() =>
        expect(adapters.beta.fetchDocument).toHaveBeenCalledTimes(1),
      );

      const beta = await independent;

      expect(beta.results[0].title).toBe("Beta");
      expect(adapters.alpha.fetchCatalog).toHaveBeenCalledTimes(1);

      release.resolve();

      await active;
      await service.searchDocs(request("alpha"));

      expect(adapters.alpha.fetchCatalog).toHaveBeenCalledTimes(2);
    });

    test("aborting one active library leaves another active library's workers and queue intact", async () => {
      const { service, adapters } = setup();

      const controllers = {
        alpha: new AbortController(),
        beta: new AbortController(),
      };
      const releases = {
        alpha: Promise.withResolvers(),
        beta: Promise.withResolvers(),
      };
      const signals = { alpha: [], beta: [] };
      const originals = {};

      for (const library of ["alpha", "beta"]) {
        originals[library] =
          adapters[library].fetchDocument.getMockImplementation();

        adapters[library].fetchDocument.mockImplementation(
          async (documentPath, signal) => {
            signals[library].push(signal);

            await new Promise((resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
              releases[library].promise.then(resolve);
            });

            return originals[library](documentPath);
          },
        );
      }

      const alpha = service.searchDocs(
        request("alpha"),
        controllers.alpha.signal,
      );
      const rejected = expect(alpha).rejects.toThrow("Cancel alpha");
      const beta = service.searchDocs(request("beta"), controllers.beta.signal);

      onTestFinished(async () => {
        releases.alpha.resolve();
        releases.beta.resolve();
        await Promise.allSettled([alpha, beta]);
      });

      await vi.waitFor(() => {
        expect(signals.alpha).toHaveLength(2);
        expect(signals.beta).toHaveLength(1);
      });

      controllers.alpha.abort(new Error("Cancel alpha"));

      await rejected;

      expect(signals.beta.every((signal) => !signal.aborted)).toBe(true);

      releases.beta.resolve();

      expect((await beta).results[0].title).toBe("Beta");

      adapters.alpha.fetchDocument.mockImplementation(originals.alpha);
      adapters.beta.fetchDocument.mockImplementation(originals.beta);

      expect(
        (await service.searchDocs(request("alpha"))).coverage.indexedDocuments,
      ).toBe(2);
      expect(
        (await service.searchDocs(request("beta"))).coverage.indexedDocuments,
      ).toBe(1);
    });
  });
});

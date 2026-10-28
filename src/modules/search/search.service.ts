import { Inject, Injectable } from "@nestjs/common";
import { contentHash } from "../cache/utils/content-hash.util.js";
import { MarkdownDocumentParser } from "../documentation/parsers/markdown-document.parser.js";
import { LibraryRegistry } from "../libraries/library-registry.service.js";
import type { ISourceAdapter } from "../sources/interfaces/source-adapter.interface.js";
import type { ISourceDocument } from "../sources/interfaces/source-document.interface.js";
import { SearchError } from "./errors/search.error.js";
import { SectionIndex } from "./section-index.js";
import {
  searchDocsInputSchema,
  type TSearchDocsInput,
  type TSearchDocsResult,
} from "./schemas/search-docs.schema.js";
import { searchSnippet } from "./utils/search-snippet.util.js";
import { queryTerms } from "./utils/tokenize.util.js";

@Injectable()
export class SearchService {
  private readonly index = new SectionIndex();
  private readonly hashes = new Map<string, string>();
  // Serialize index synchronization, one request's abort never cancels another
  private pending: Promise<void> = Promise.resolve();

  constructor(
    @Inject(LibraryRegistry) private readonly registry: LibraryRegistry,
    @Inject(MarkdownDocumentParser)
    private readonly parser: MarkdownDocumentParser,
  ) {}

  async searchDocs(
    input: TSearchDocsInput,
    signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => Promise<void>,
  ): Promise<TSearchDocsResult> {
    const validation = searchDocsInputSchema.safeParse(input);

    if (!validation.success) {
      throw new SearchError("INVALID_REQUEST", validation.error.message);
    }

    signal?.throwIfAborted();

    const registration = this.registry.get(validation.data.library);

    if (!registration) {
      throw new SearchError("INVALID_REQUEST", "Unsupported library.");
    }

    const adapter = registration.adapter;

    if (
      validation.data.path_prefix &&
      !adapter.isValidPath(validation.data.path_prefix)
    ) {
      throw new SearchError(
        "INVALID_REQUEST",
        "Invalid documentation path prefix for this library.",
      );
    }

    const task = this.pending.then(() =>
      this.synchronizeAndSearch(validation.data, adapter, signal, onProgress),
    );
    this.pending = task.then(
      () => {},
      () => {},
    );

    if (!signal) {
      return task;
    }

    // Waiting for a different request's indexing must also be cancellable
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });

      if (signal.aborted) {
        abort();
      }

      task
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }

  private async synchronizeAndSearch(
    request: ReturnType<typeof searchDocsInputSchema.parse>,
    adapter: ISourceAdapter,
    signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => Promise<void>,
  ): Promise<TSearchDocsResult> {
    signal?.throwIfAborted();

    const catalog = await adapter
      .fetchCatalog(signal, { refresh: request.refresh })
      .catch((cause: unknown) => {
        signal?.throwIfAborted();
        throw new SearchError(
          "SOURCE_ERROR",
          "Could not load the documentation catalog.",
          { cause },
        );
      });

    signal?.throwIfAborted();

    const catalogPaths = new Set(
      catalog.documents.map((document) => document.path),
    );
    this.index.retain(catalogPaths);

    for (const path of this.hashes.keys()) {
      if (!catalogPaths.has(path)) this.hashes.delete(path);
    }

    const selected = catalog.documents.filter(
      ({ path }) =>
        !request.path_prefix ||
        path === request.path_prefix ||
        path.startsWith(`${request.path_prefix}/`),
    );

    const documents = new Map<string, ISourceDocument>();
    const failures: TSearchDocsResult["coverage"]["failures"] = [];

    let cursor = 0;
    let completed = 0;

    await onProgress?.(0, selected.length);

    const worker = async () => {
      while (cursor < selected.length) {
        signal?.throwIfAborted();

        const reference = selected[cursor++]!;
        let code: "SOURCE_ERROR" | "PARSE_ERROR" = "SOURCE_ERROR";

        try {
          const source = await adapter.fetchDocument(reference.path, signal, {
            refresh: request.refresh,
          });

          signal?.throwIfAborted();

          const hash = contentHash(source.content);
          code = "PARSE_ERROR";

          if (this.hashes.get(reference.path) !== hash) {
            const parsed = this.parser.parse(source);

            this.index.replace(parsed);
            this.hashes.set(reference.path, hash);
          }
          documents.set(reference.path, source);
        } catch {
          signal?.throwIfAborted();

          // Never search an old in-memory revision after a failed current load
          this.index.remove(reference.path);
          this.hashes.delete(reference.path);

          failures.push({ path: reference.path, code });
        }
        completed += 1;
        await onProgress?.(completed, selected.length);
      }
    };

    // Drain all workers, including on cancellation, before releasing the queue
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(4, selected.length) }, worker),
    );

    signal?.throwIfAborted();

    for (const result of workers) {
      if (result.status === "rejected") {
        throw result.reason;
      }
    }

    if (selected.length && !documents.size) {
      throw new SearchError(
        "INDEX_UNAVAILABLE",
        "None of the selected documentation pages could be indexed. Retry or narrow path_prefix.",
      );
    }

    const paths = new Set(documents.keys());
    const terms = queryTerms(request.query);
    const matches = this.index.search(terms, paths);

    failures.sort((left, right) => left.path.localeCompare(right.path, "en"));

    return {
      libraryId: request.library,
      channel: "current",
      query: request.query,
      terms,
      totalMatches: matches.length,
      results: matches
        .slice(0, request.limit)
        .map(({ section, score, matchedTerms }) => {
          const source = documents.get(section.path)!;
          const hash = this.hashes.get(section.path)!;
          return {
            path: section.path,
            sourceUrl: source.sourceUrl,
            title: section.title,
            sectionId: section.sectionId,
            sectionTitle: section.sectionTitle,
            headingPath: section.headingPath,
            startLine: section.startLine,
            endLine: section.endLine,
            snippet: searchSnippet(section.content, terms),
            score: Math.round(score * 1_000_000) / 1_000_000,
            matchedTerms,
            contentHash: hash,
            fetchedAt: source.fetchedAt,
            ...(source.cache ? { cache: source.cache } : {}),
            getDocumentation: {
              library: request.library,
              path: section.path,
              section_id: section.sectionId,
              expected_hash: hash,
            },
          };
        }),
      coverage: {
        catalogUrl: catalog.sourceUrl,
        ...(catalog.cache ? { catalogCache: catalog.cache } : {}),
        ...(catalog.docVersion ? { docVersion: catalog.docVersion } : {}),
        scope: "root-catalog",
        ...(request.path_prefix ? { pathPrefix: request.path_prefix } : {}),
        catalogDocuments: catalog.documents.length,
        selectedDocuments: selected.length,
        indexedDocuments: documents.size,
        indexedSections: this.index.sectionCount(paths),
        failedDocuments: failures.length,
        staleDocuments: [...documents.values()].filter(
          (source) => source.cache?.status === "stale",
        ).length,
        partial: failures.length > 0,
        failures: failures.slice(0, 20),
        failuresTruncated: failures.length > 20,
      },
    };
  }
}

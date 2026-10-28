import { Inject, Injectable } from "@nestjs/common";
import { contentHash } from "../cache/utils/content-hash.util.js";
import { MarkdownDocumentParser } from "../documentation/parsers/markdown-document.parser.js";
import { LibraryRegistry } from "../libraries/library-registry.service.js";
import { CURRENT_DOCUMENTATION_SET_ID } from "../libraries/constants/documentation-set.constant.js";
import type { IDocumentationScope } from "../libraries/interfaces/documentation-scope.interface.js";
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

interface ISearchState {
  readonly index: SectionIndex;
  readonly hashes: Map<string, string>;
  pending: Promise<void>;
}

@Injectable()
export class SearchService {
  private readonly states = new Map<string, ISearchState>();

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

    const state = this.stateFor({
      libraryId: registration.id,
      documentationSetId: CURRENT_DOCUMENTATION_SET_ID,
    });

    // Serialize within a scope, different libraries can index independently
    const task = state.pending.then(() =>
      this.synchronizeAndSearch(
        validation.data,
        adapter,
        state,
        signal,
        onProgress,
      ),
    );
    state.pending = task.then(
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

  private stateFor(scope: IDocumentationScope): ISearchState {
    const key = JSON.stringify([scope.libraryId, scope.documentationSetId]);
    let state = this.states.get(key);

    if (!state) {
      state = {
        index: new SectionIndex(),
        hashes: new Map(),
        pending: Promise.resolve(),
      };
      this.states.set(key, state);
    }

    return state;
  }

  private async synchronizeAndSearch(
    request: ReturnType<typeof searchDocsInputSchema.parse>,
    adapter: ISourceAdapter,
    state: ISearchState,
    signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => Promise<void>,
  ): Promise<TSearchDocsResult> {
    signal?.throwIfAborted();

    const { index, hashes } = state;

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
    index.retain(catalogPaths);

    for (const path of hashes.keys()) {
      if (!catalogPaths.has(path)) hashes.delete(path);
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

          if (hashes.get(reference.path) !== hash) {
            const parsed = this.parser.parse(source);

            index.replace(parsed);
            hashes.set(reference.path, hash);
          }
          documents.set(reference.path, source);
        } catch {
          signal?.throwIfAborted();

          // Never search an old in-memory revision after a failed current load
          index.remove(reference.path);
          hashes.delete(reference.path);

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
    const matches = index.search(terms, paths);

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
          const hash = hashes.get(section.path)!;
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
        indexedSections: index.sectionCount(paths),
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

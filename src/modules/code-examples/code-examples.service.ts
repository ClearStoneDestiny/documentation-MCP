import { Inject, Injectable } from "@nestjs/common";
import { contentHash } from "../cache/utils/content-hash.util.js";
import { DocumentationError } from "../documentation/errors/documentation.error.js";
import type { IDocumentSection } from "../documentation/interfaces/document-section.interface.js";
import type { IParsedDocument } from "../documentation/interfaces/parsed-document.interface.js";
import { LibraryRegistry } from "../libraries/library-registry.service.js";
import { queryTerms } from "../search/utils/tokenize.util.js";
import {
  getCodeExamplesInputSchema,
  type TGetCodeExamplesInput,
  type TGetCodeExamplesResult,
} from "./schemas/get-code-examples.schema.js";
import { getLanguageNameById } from "./utils/get-language-name-by-id.util.js";
import { retainSectionProse } from "./utils/retain-section-prose.util.js";

@Injectable()
export class CodeExamplesService {
  constructor(
    @Inject(LibraryRegistry) private readonly registry: LibraryRegistry,
  ) {}

  async getCodeExamples(
    input: TGetCodeExamplesInput,
    signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => Promise<void>,
  ): Promise<TGetCodeExamplesResult> {
    const validation = getCodeExamplesInputSchema.safeParse(input);

    if (!validation.success) {
      throw new DocumentationError("INVALID_REQUEST", validation.error.message);
    }

    const request = validation.data;

    signal?.throwIfAborted();

    const registration = this.registry.get(request.library);

    if (!registration) {
      throw new DocumentationError("INVALID_REQUEST", "Unsupported library.");
    }

    const operation = registration.operations.get_code_examples;

    if (!operation) {
      throw new DocumentationError(
        "TOOL_UNSUPPORTED",
        `get_code_examples is not supported for library ${registration.id}.`,
      );
    }

    if (request.version !== "current") {
      throw new DocumentationError(
        "VERSION_UNAVAILABLE",
        "Only the current documentation set is available. Use version: current; package release numbers and compatibility ranges are not documentation-set selectors.",
      );
    }

    const prefix = request.filters?.path_prefix;

    if (prefix && !operation.isValidPath(prefix)) {
      throw new DocumentationError(
        "INVALID_REQUEST",
        "Invalid documentation path prefix for this library.",
      );
    }

    const catalog = await operation
      .fetchCatalog(signal, { refresh: request.refresh })
      .catch((cause: unknown) => {
        signal?.throwIfAborted();

        throw new DocumentationError(
          "SOURCE_ERROR",
          "Could not load the documentation catalog.",
          { cause },
        );
      });

    signal?.throwIfAborted();

    const selected = catalog.documents.filter(
      ({ path }) => !prefix || path === prefix || path.startsWith(`${prefix}/`),
    );

    const documents = new Map<string, IParsedDocument>();
    const failures: TGetCodeExamplesResult["coverage"]["failures"] = [];

    let cursor = 0;
    let completed = 0;

    await onProgress?.(0, selected.length);

    const worker = async () => {
      while (cursor < selected.length) {
        signal?.throwIfAborted();

        const reference = selected[cursor++]!;
        let code: "SOURCE_ERROR" | "PARSE_ERROR" = "SOURCE_ERROR";

        try {
          const source = await operation.fetchDocument(reference.path, signal, {
            refresh: request.refresh,
          });

          signal?.throwIfAborted();

          code = "PARSE_ERROR";
          documents.set(reference.path, operation.parse(source));
        } catch {
          signal?.throwIfAborted();
          failures.push({ path: reference.path, code });
        }
        completed += 1;

        await onProgress?.(completed, selected.length);
      }
    };

    // Each request owns its index, cancellation cannot affect other requests
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(4, selected.length) }, worker),
    );

    signal?.throwIfAborted();

    for (const worker of workers) {
      if (worker.status === "rejected") {
        throw worker.reason;
      }
    }

    if (selected.length && !documents.size) {
      throw new DocumentationError(
        "INDEX_UNAVAILABLE",
        "None of the selected documentation pages could be parsed. Retry or narrow filters.path_prefix.",
      );
    }

    const index = operation.createIndex();

    type TExample = TGetCodeExamplesResult["examples"][number];
    const examples = new Map<string, TExample>();
    const languages = request.filters?.languages?.map(getLanguageNameById);

    for (const document of documents.values()) {
      signal?.throwIfAborted();

      const hash = contentHash(document.content);
      const sections: IDocumentSection[] = [];

      for (const section of document.sections) {
        const prose = retainSectionProse(section);

        for (const example of section.codeExamples) {
          if (!example.code.trim()) {
            continue;
          }

          if (
            languages &&
            (!example.language ||
              !languages.includes(getLanguageNameById(example.language)))
          ) {
            continue;
          }

          const key = JSON.stringify([document.path, example.id]);

          examples.set(key, {
            code: example.code,
            ...(example.language ? { language: example.language } : {}),
            ...(example.meta ? { meta: example.meta } : {}),
            sourceUrl: document.sourceUrl,
            sectionTitle: section.title,
            fetchedAt: document.fetchedAt,
            ...(document.cache ? { cache: document.cache } : {}),
            getDocumentation: {
              library: request.library,
              path: document.path,
              section_id: section.id,
              expected_hash: hash,
            },
          });

          sections.push({
            ...section,
            id: example.id,
            content: `${prose}\n${example.code}`,
            range: example.range,
            codeExamples: [],
          });
        }
      }

      index.replace({ ...document, sections });
    }
    const terms = queryTerms(request.query);
    const matches = index.search(terms, new Set(documents.keys()));

    failures.sort((a, b) => a.path.localeCompare(b.path, "en"));

    return {
      libraryId: request.library,
      version: "current",
      totalMatches: matches.length,
      examples: matches
        .slice(0, request.limit)
        .map(
          ({ section }) =>
            examples.get(JSON.stringify([section.path, section.sectionId]))!,
        ),
      coverage: {
        catalogUrl: catalog.sourceUrl,
        ...(catalog.cache ? { catalogCache: catalog.cache } : {}),
        ...(catalog.docVersion ? { docVersion: catalog.docVersion } : {}),
        scope: "root-catalog",
        ...(prefix ? { pathPrefix: prefix } : {}),
        catalogDocuments: catalog.documents.length,
        selectedDocuments: selected.length,
        indexedDocuments: documents.size,
        indexedExamples: examples.size,
        failedDocuments: failures.length,
        staleDocuments: [...documents.values()].filter(
          (doc) => doc.cache?.status === "stale",
        ).length,
        partial: failures.length > 0,
        failures: failures.slice(0, 20),
        failuresTruncated: failures.length > 20,
      },
    };
  }
}

import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { LibraryRegistry } from "../libraries/library-registry.service.js";
import { DocumentationError } from "./errors/documentation.error.js";
import type { IParsedDocument } from "./interfaces/parsed-document.interface.js";
import {
  getDocumentationInputSchema,
  type TGetDocumentationInput,
  type TGetDocumentationResult,
} from "./schemas/get-documentation.schema.js";

@Injectable()
export class DocumentationService {
  constructor(
    @Inject(LibraryRegistry) private readonly registry: LibraryRegistry,
  ) {}

  async getDocumentation(
    input: TGetDocumentationInput,
    signal?: AbortSignal,
  ): Promise<TGetDocumentationResult> {
    const validation = getDocumentationInputSchema.safeParse(input);

    if (!validation.success) {
      throw new DocumentationError("INVALID_REQUEST", validation.error.message);
    }

    const request = validation.data;

    signal?.throwIfAborted();

    const registration = this.registry.get(request.library);

    if (!registration) {
      throw new DocumentationError("INVALID_REQUEST", "Unsupported library.");
    }

    const operation = registration.operations.get_documentation;

    if (!operation) {
      throw new DocumentationError(
        "TOOL_UNSUPPORTED",
        `get_documentation is not supported for library ${registration.id}.`,
      );
    }

    if (!operation.isValidPath(request.path)) {
      throw new DocumentationError(
        "INVALID_REQUEST",
        "Invalid documentation path for this library.",
      );
    }

    const source = await operation
      .fetchDocument(request.path, signal, { refresh: request.refresh })
      .catch((cause: unknown) => {
        signal?.throwIfAborted();

        const message =
          cause instanceof Error ? cause.message : "Request failed";

        throw new DocumentationError("SOURCE_ERROR", message, { cause });
      });

    signal?.throwIfAborted();

    const contentHash = createHash("sha256")
      .update(source.content)
      .digest("hex");

    if (request.expected_hash && request.expected_hash !== contentHash) {
      throw new DocumentationError(
        "DOCUMENT_CHANGED",
        "Documentation changed since the previous response. Restart at offset 0 without expected_hash.",
      );
    }

    let document: IParsedDocument;

    try {
      document = operation.parse(source);
    } catch (cause) {
      throw new DocumentationError(
        "PARSE_ERROR",
        "Could not parse the documentation page.",
        { cause },
      );
    }

    let selectedContent = document.content;

    if (request.section_id) {
      const index = document.sections.findIndex(
        (section) => section.id === request.section_id,
      );

      const section = document.sections[index];

      if (!section) {
        throw new DocumentationError(
          "SECTION_NOT_FOUND",
          `Unknown section: ${request.section_id}. Call without section_id to obtain available section IDs.`,
        );
      }

      // Heading sections include descendants, the synthetic introduction is only its own content
      const nextSibling =
        section.depth === 0
          ? undefined
          : document.sections
              .slice(index + 1)
              .find((candidate) => candidate.depth <= section.depth);
      const end =
        section.depth === 0
          ? section.range.endOffset
          : (nextSibling?.range.startOffset ?? document.content.length);
      selectedContent = document.content.slice(section.range.startOffset, end);
    }

    const { offset, max_chars: maxChars } = request;

    if (
      offset > selectedContent.length ||
      isInsideSurrogatePair(selectedContent, offset)
    ) {
      throw new DocumentationError(
        "INVALID_REQUEST",
        "Offset is outside the selection or splits a Unicode character.",
      );
    }

    let end = Math.min(offset + maxChars, selectedContent.length);

    if (isInsideSurrogatePair(selectedContent, end)) {
      end -= 1;
    }

    const truncated = end < selectedContent.length;

    return {
      libraryId: registration.id,
      path: document.path,
      sourceUrl: document.sourceUrl,
      title: document.title,
      ...(document.description ? { description: document.description } : {}),
      ...(document.lastUpdated ? { lastUpdated: document.lastUpdated } : {}),
      fetchedAt: document.fetchedAt,
      ...(document.cache ? { cache: document.cache } : {}),
      channel: "current",
      contentHash,
      selectedSectionId: request.section_id ?? null,
      sections: document.sections.map(({ id, title, depth, parentId }) => ({
        id,
        title,
        depth,
        ...(parentId ? { parentId } : {}),
      })),
      content: selectedContent.slice(offset, end),
      pagination: {
        offset,
        nextOffset: truncated ? end : null,
        totalChars: selectedContent.length,
        truncated,
      },
    };
  }
}

function isInsideSurrogatePair(content: string, offset: number): boolean {
  const previous = content.charCodeAt(offset - 1);
  const next = content.charCodeAt(offset);

  return (
    previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  );
}

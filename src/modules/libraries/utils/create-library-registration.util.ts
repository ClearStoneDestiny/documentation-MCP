import { LIBRARY_TOOL_NAMES } from "../constants/library.constant.js";
import type { ILibraryDefinition } from "../interfaces/library-definition.interface.js";
import type { TLibraryId } from "../interfaces/library-id.type.js";
import type { ILibraryRegistration } from "../interfaces/library-registration.interface.js";
import type { ISourceAdapter } from "../../sources/interfaces/source-adapter.interface.js";
import type { DocumentPipelineRegistry } from "../../documentation/document-pipeline-registry.service.js";
import { resolveLibraryOperations } from "./resolve-library-operations.util.js";

export function createLibraryRegistration(
  id: TLibraryId,
  definition: ILibraryDefinition,
  adapter: ISourceAdapter,
  pipelines: DocumentPipelineRegistry,
): ILibraryRegistration {
  // TODO: improve readability
  if (
    [
      adapter.isValidPath,
      adapter.fetchCatalog,
      adapter.fetchDocument,
      adapter.listDocumentationSets,
    ].some((method) => method !== undefined && typeof method !== "function") ||
    (adapter.documentFormat !== undefined &&
      (typeof adapter.documentFormat !== "string" ||
        !adapter.documentFormat.trim()))
  ) {
    throw new Error(`Invalid source adapter: ${id}`);
  }

  if (adapter.libraryId !== id) {
    throw new Error(`Adapter library ID does not match its definition: ${id}`);
  }

  const operations = resolveLibraryOperations(adapter, pipelines);

  return Object.freeze({
    id,
    name: definition.name,
    documentationUrl: definition.documentationUrl,
    capabilities: Object.freeze({
      tools: Object.freeze(
        LIBRARY_TOOL_NAMES.filter((tool) => operations[tool] !== undefined),
      ),
      // Every installed operation currently resolves only the current set
      historicalDocumentation: false,
    }),
    adapter,
    operations,
  });
}

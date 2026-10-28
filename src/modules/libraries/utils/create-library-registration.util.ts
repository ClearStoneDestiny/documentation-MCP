import { LIBRARY_TOOL_NAMES } from "../constants/library.constant.js";
import type { ILibraryDefinition } from "../interfaces/library-definition.interface.js";
import type { TLibraryId } from "../interfaces/library-id.type.js";
import type { ILibraryRegistration } from "../interfaces/library-registration.interface.js";
import type { ISourceAdapter } from "../../sources/interfaces/source-adapter.interface.js";

export function createLibraryRegistration(
  id: TLibraryId,
  definition: ILibraryDefinition,
  adapter: ISourceAdapter,
): ILibraryRegistration {
  if (
    typeof adapter.isValidPath !== "function" ||
    typeof adapter.fetchCatalog !== "function" ||
    typeof adapter.fetchDocument !== "function"
  ) {
    throw new Error(`Invalid source adapter: ${id}`);
  }

  if (adapter.libraryId !== id) {
    throw new Error(`Adapter library ID does not match its definition: ${id}`);
  }

  return Object.freeze({
    id,
    name: definition.name,
    documentationUrl: definition.documentationUrl,
    // Preserve the existing current-Markdown contract. Capability resolution
    // will be extended alongside support for other source pipelines
    capabilities: Object.freeze({
      tools: Object.freeze([...LIBRARY_TOOL_NAMES]),
      historicalDocumentation: false,
    }),
    adapter,
  });
}

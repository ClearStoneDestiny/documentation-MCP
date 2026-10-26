import type { ISourceDocumentReference } from "./source-document-reference.interface.js";
import type { TCacheInfo } from "../../cache/schemas/cache.schema.js";

export interface ISourceCatalog {
  libraryId: string;
  sourceUrl: string;
  fetchedAt: string;
  cache?: TCacheInfo;
  // Version declared by the index, not an immutable documentation revision
  docVersion?: string;
  documents: ISourceDocumentReference[];
}

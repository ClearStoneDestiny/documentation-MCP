import type { ISourceDocumentReference } from "./source-document-reference.interface.js";

export interface ISourceCatalog {
  libraryId: string;
  sourceUrl: string;
  fetchedAt: string;
  // Version declared by the index, not an immutable documentation revision
  docVersion?: string;
  documents: ISourceDocumentReference[];
}

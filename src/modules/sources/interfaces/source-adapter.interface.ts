import type { ISourceDocument } from "./source-document.interface.js";
import type { ISourceCatalog } from "./source-catalog.interface.js";

export interface ISourceAdapter {
  readonly libraryId: string;
  fetchCatalog(signal?: AbortSignal): Promise<ISourceCatalog>;
  fetchDocument(path: string, signal?: AbortSignal): Promise<ISourceDocument>;
}

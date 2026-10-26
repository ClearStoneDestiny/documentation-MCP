import type { ISourceDocument } from "./source-document.interface.js";
import type { ISourceCatalog } from "./source-catalog.interface.js";
import type { ISourceFetchOptions } from "./source-fetch-options.interface.js";

export interface ISourceAdapter {
  readonly libraryId: string;
  fetchCatalog(signal?: AbortSignal, options?: ISourceFetchOptions): Promise<ISourceCatalog>;
  fetchDocument(path: string, signal?: AbortSignal, options?: ISourceFetchOptions): Promise<ISourceDocument>;
}

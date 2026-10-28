import type { ISourceDocument } from "./source-document.interface.js";
import type { ISourceCatalog } from "./source-catalog.interface.js";
import type { ISourceFetchOptions } from "./source-fetch-options.interface.js";

export interface ISourceAdapter {
  readonly libraryId: string;
  // Format returned by fetchDocument, after any adapter-specific conversion
  readonly documentFormat?: string;
  // Syntax rules for document paths and subtree prefixes, not page existence
  isValidPath?(path: string): boolean;
  // Optional discovery returns a normalized catalog, not raw source markup
  fetchCatalog?(
    signal?: AbortSignal,
    options?: ISourceFetchOptions,
  ): Promise<ISourceCatalog>;
  fetchDocument?(
    path: string,
    signal?: AbortSignal,
    options?: ISourceFetchOptions,
  ): Promise<ISourceDocument>;
}

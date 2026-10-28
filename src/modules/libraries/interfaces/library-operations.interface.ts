import type { ISourceAdapter } from "../../sources/interfaces/source-adapter.interface.js";
import { IDocumentationOperation } from "./documentation-operation.interface.js";
import { IIndexedDocumentationOperation } from "./indexed-documentation-operation.interface.js";

export interface ILibraryOperations {
  readonly get_documentation?: IDocumentationOperation;
  readonly search_docs?: IIndexedDocumentationOperation;
  readonly get_code_examples?: IIndexedDocumentationOperation;
  readonly list_versions?: {
    readonly fetchCatalog: NonNullable<ISourceAdapter["fetchCatalog"]>;
  };
}

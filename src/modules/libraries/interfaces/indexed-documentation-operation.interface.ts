import { SectionIndex } from "../../search/section-index.js";
import { ISourceAdapter } from "../../sources/interfaces/source-adapter.interface.js";
import { IDocumentationOperation } from "./documentation-operation.interface.js";

export interface IIndexedDocumentationOperation extends IDocumentationOperation {
  readonly fetchCatalog: NonNullable<ISourceAdapter["fetchCatalog"]>;
  readonly createIndex: () => SectionIndex;
}

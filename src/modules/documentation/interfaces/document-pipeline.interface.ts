import type { ISourceDocument } from "../../sources/interfaces/source-document.interface.js";
import type { SectionIndex } from "../../search/section-index.js";
import type { IParsedDocument } from "./parsed-document.interface.js";

export interface IDocumentPipeline {
  readonly format: string;
  readonly parse: (source: ISourceDocument) => IParsedDocument;
  // Search and example ranking require an installed index implementation
  readonly createIndex?: () => SectionIndex;
}

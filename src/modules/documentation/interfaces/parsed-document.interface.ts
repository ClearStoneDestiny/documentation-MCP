import type { ISourceDocument } from "../../sources/interfaces/source-document.interface.js";
import type { IDocumentSection } from "./document-section.interface.js";

export interface IParsedDocument extends ISourceDocument {
  title: string;
  description?: string;
  // Source-declared update time, separate from fetchedAt
  lastUpdated?: string;
  sections: IDocumentSection[];
}

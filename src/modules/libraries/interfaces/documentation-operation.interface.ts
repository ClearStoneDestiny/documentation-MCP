import { IDocumentPipeline } from "../../documentation/interfaces/document-pipeline.interface.js";
import { ISourceAdapter } from "../../sources/interfaces/source-adapter.interface.js";

export interface IDocumentationOperation {
  readonly isValidPath: NonNullable<ISourceAdapter["isValidPath"]>;
  readonly fetchDocument: NonNullable<ISourceAdapter["fetchDocument"]>;
  readonly parse: IDocumentPipeline["parse"];
}

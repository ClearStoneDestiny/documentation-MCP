import { ISourceDocument } from "./source-document.interface.js";

export interface ISourceAdapter {
  readonly libraryId: string;
  fetchDocument(path: string, signal?: AbortSignal): Promise<ISourceDocument>;
}

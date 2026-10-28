import { SectionIndex } from "../../search/section-index.js";
import type { IDocumentPipeline } from "../interfaces/document-pipeline.interface.js";
import type { MarkdownDocumentParser } from "../parsers/markdown-document.parser.js";
import type { ISourceDocument } from "../../sources/interfaces/source-document.interface.js";

export function createMarkdownPipeline(
  parser: MarkdownDocumentParser,
): IDocumentPipeline {
  return Object.freeze({
    format: "markdown",
    parse: (source: ISourceDocument) => parser.parse(source),
    createIndex: () => new SectionIndex(),
  });
}

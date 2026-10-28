import { LIBRARY_DEFINITIONS } from "../../../../../dist/modules/libraries/constants/library-definitions.constant.js";
import { LibraryRegistry } from "../../../../../dist/modules/libraries/library-registry.service.js";
import { createLibraryRegistration } from "../../../../../dist/modules/libraries/utils/create-library-registration.util.js";
import { DocumentPipelineRegistry } from "../../../../../dist/modules/documentation/document-pipeline-registry.service.js";
import { createMarkdownPipeline } from "../../../../../dist/modules/documentation/pipelines/markdown.pipeline.js";
import { MarkdownDocumentParser } from "../../../../../dist/modules/documentation/parsers/markdown-document.parser.js";

export const nextjsSourceOptions = {
  id: "nextjs",
  documentationUrl: LIBRARY_DEFINITIONS.nextjs.documentationUrl,
  sources: LIBRARY_DEFINITIONS.nextjs.sources,
};

export const nextjsCacheScope = {
  libraryId: nextjsSourceOptions.id,
  documentationSetId: "current",
};

export function createRegistry(
  adapter,
  definition = LIBRARY_DEFINITIONS.nextjs,
  parser = new MarkdownDocumentParser(),
) {
  return new LibraryRegistry([
    createLibraryRegistration(
      adapter.libraryId,
      definition,
      adapter,
      new DocumentPipelineRegistry([createMarkdownPipeline(parser)]),
    ),
  ]);
}

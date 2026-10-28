import type { DocumentPipelineRegistry } from "../../documentation/document-pipeline-registry.service.js";
import type { ISourceAdapter } from "../../sources/interfaces/source-adapter.interface.js";
import type { ILibraryOperations } from "../interfaces/library-operations.interface.js";

// Resolve executable operations once. Discovery and invocation use the same result
export function resolveLibraryOperations(
  adapter: ISourceAdapter,
  pipelines: DocumentPipelineRegistry,
): ILibraryOperations {
  const pipeline = adapter.documentFormat
    ? pipelines.get(adapter.documentFormat)
    : undefined;

  const fetchCatalog = adapter.fetchCatalog?.bind(adapter);
  
  const documentation =
    adapter.fetchDocument && adapter.isValidPath && pipeline
      ? Object.freeze({
          fetchDocument: adapter.fetchDocument.bind(adapter),
          isValidPath: adapter.isValidPath.bind(adapter),
          parse: pipeline.parse.bind(pipeline),
        })
      : undefined;

  const indexed =
    documentation && fetchCatalog && pipeline?.createIndex
      ? Object.freeze({
          ...documentation,
          fetchCatalog,
          createIndex: pipeline.createIndex.bind(pipeline),
        })
      : undefined;

  return Object.freeze({
    ...(documentation ? { get_documentation: documentation } : {}),
    ...(indexed ? { search_docs: indexed, get_code_examples: indexed } : {}),
    ...(fetchCatalog ? { list_versions: Object.freeze({ fetchCatalog }) } : {}),
  });
}

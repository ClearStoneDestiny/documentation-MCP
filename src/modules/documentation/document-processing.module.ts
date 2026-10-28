import { Module } from "@nestjs/common";
import { DOCUMENT_PIPELINES } from "./constants/document-pipelines.constant.js";
import { DocumentPipelineRegistry } from "./document-pipeline-registry.service.js";
import { MarkdownDocumentParser } from "./parsers/markdown-document.parser.js";
import { createMarkdownPipeline } from "./pipelines/markdown.pipeline.js";

@Module({
  providers: [
    MarkdownDocumentParser,
    {
      provide: DOCUMENT_PIPELINES,
      inject: [MarkdownDocumentParser],
      useFactory: (parser: MarkdownDocumentParser) => [
        createMarkdownPipeline(parser),
      ],
    },
    DocumentPipelineRegistry,
  ],
  exports: [MarkdownDocumentParser, DocumentPipelineRegistry],
})
export class DocumentProcessingModule {}

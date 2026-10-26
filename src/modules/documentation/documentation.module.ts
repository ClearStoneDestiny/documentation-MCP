import { Module } from "@nestjs/common";
import { MarkdownDocumentParser } from "./parsers/markdown-document.parser.js";
import { SourcesModule } from "../sources/sources.module.js";
import { DocumentationService } from "./documentation.service.js";

@Module({
  imports: [SourcesModule],
  providers: [MarkdownDocumentParser, DocumentationService],
  exports: [MarkdownDocumentParser, DocumentationService],
})
export class DocumentationModule {}

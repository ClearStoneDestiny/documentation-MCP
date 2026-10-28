import { Module } from "@nestjs/common";
import { MarkdownDocumentParser } from "./parsers/markdown-document.parser.js";
import { LibrariesModule } from "../libraries/libraries.module.js";
import { DocumentationService } from "./documentation.service.js";

@Module({
  imports: [LibrariesModule],
  providers: [MarkdownDocumentParser, DocumentationService],
  exports: [MarkdownDocumentParser, DocumentationService],
})
export class DocumentationModule {}

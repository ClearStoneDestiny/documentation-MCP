import { Module } from "@nestjs/common";
import { MarkdownDocumentParser } from "./parsers/markdown-document.parser.js";

@Module({
  providers: [MarkdownDocumentParser],
  exports: [MarkdownDocumentParser],
})
export class DocumentationModule {}

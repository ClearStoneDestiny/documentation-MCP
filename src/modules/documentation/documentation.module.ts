import { Module } from "@nestjs/common";
import { DocumentProcessingModule } from "./document-processing.module.js";
import { LibrariesModule } from "../libraries/libraries.module.js";
import { DocumentationService } from "./documentation.service.js";

@Module({
  imports: [LibrariesModule, DocumentProcessingModule],
  providers: [DocumentationService],
  exports: [DocumentProcessingModule, DocumentationService],
})
export class DocumentationModule {}

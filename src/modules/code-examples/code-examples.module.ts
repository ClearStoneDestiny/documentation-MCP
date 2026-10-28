import { Module } from "@nestjs/common";
import { DocumentationModule } from "../documentation/documentation.module.js";
import { LibrariesModule } from "../libraries/libraries.module.js";
import { CodeExamplesService } from "./code-examples.service.js";

@Module({
  imports: [DocumentationModule, LibrariesModule],
  providers: [CodeExamplesService],
  exports: [CodeExamplesService],
})
export class CodeExamplesModule {}

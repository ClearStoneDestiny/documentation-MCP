import { Module } from "@nestjs/common";
import { LibrariesModule } from "../libraries/libraries.module.js";
import { CodeExamplesService } from "./code-examples.service.js";

@Module({
  imports: [LibrariesModule],
  providers: [CodeExamplesService],
  exports: [CodeExamplesService],
})
export class CodeExamplesModule {}

import { Module } from "@nestjs/common";
import { DocumentationModule } from "../documentation/documentation.module.js";
import { LibrariesModule } from "../libraries/libraries.module.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [LibrariesModule, DocumentationModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}

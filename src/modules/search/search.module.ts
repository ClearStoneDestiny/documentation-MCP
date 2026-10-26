import { Module } from "@nestjs/common";
import { DocumentationModule } from "../documentation/documentation.module.js";
import { SourcesModule } from "../sources/sources.module.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [SourcesModule, DocumentationModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}

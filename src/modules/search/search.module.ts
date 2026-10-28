import { Module } from "@nestjs/common";
import { LibrariesModule } from "../libraries/libraries.module.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [LibrariesModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}

import { Module } from "@nestjs/common";
import { LIBRARY_DEFINITIONS } from "../libraries/constants/library-definitions.constant.js";
import { LibrarySourcesModule } from "./library-sources.module.js";

@Module({
  imports: [LibrarySourcesModule.register(LIBRARY_DEFINITIONS)],
  exports: [LibrarySourcesModule],
})
export class SourcesModule {}

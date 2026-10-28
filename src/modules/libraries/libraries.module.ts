import { Module } from "@nestjs/common";
import { VersionService } from "./version.service.js";
import { SourcesModule } from "../sources/sources.module.js";
import { LibraryRegistry } from "./library-registry.service.js";
import { LibraryService } from "./library.service.js";

@Module({
  imports: [SourcesModule],
  providers: [VersionService, LibraryRegistry, LibraryService],
  exports: [VersionService, LibraryRegistry, LibraryService],
})
export class LibrariesModule {}

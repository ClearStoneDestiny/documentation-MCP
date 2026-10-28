import { Module } from "@nestjs/common";
import { VersionService } from "./version.service.js";
import { SourcesModule } from "../sources/sources.module.js";

@Module({
  imports: [SourcesModule],
  providers: [VersionService],
  exports: [VersionService],
})
export class LibrariesModule {}

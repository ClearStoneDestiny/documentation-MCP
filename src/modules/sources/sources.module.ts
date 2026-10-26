import { Module } from "@nestjs/common";
import { NextjsAdapter } from "./adapters/nextjs.adapter.js";
import { CacheModule } from "../cache/cache.module.js";
import { CachedMarkdownService } from "./services/cached-markdown.service.js";

@Module({
  imports: [CacheModule],
  providers: [NextjsAdapter, CachedMarkdownService],
  exports: [NextjsAdapter],
})
export class SourcesModule {}

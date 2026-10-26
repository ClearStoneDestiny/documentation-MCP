import { Module } from "@nestjs/common";
import { NextjsAdapter } from "./adapters/nextjs.adapter.js";

@Module({
  providers: [NextjsAdapter],
  exports: [NextjsAdapter],
})
export class SourcesModule {}

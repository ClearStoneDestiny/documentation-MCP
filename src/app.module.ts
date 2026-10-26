import { Module } from "@nestjs/common";
import { McpModule } from "./modules/mcp/mcp.module.js";
import { SourcesModule } from "./modules/sources/sources.module.js";
import { DocumentationModule } from "./modules/documentation/documentation.module.js";

@Module({
  imports: [McpModule, SourcesModule, DocumentationModule],
})
export class AppModule {}

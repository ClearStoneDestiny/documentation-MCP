import { Module } from "@nestjs/common";
import { McpService } from "./mcp.service.js";
import { DocumentationModule } from "../documentation/documentation.module.js";
import { GetDocumentationTool } from "./tools/get-documentation.tool.js";
import { SearchModule } from "../search/search.module.js";
import { SearchDocsTool } from "./tools/search-docs.tool.js";

@Module({
  imports: [DocumentationModule, SearchModule],
  providers: [McpService, GetDocumentationTool, SearchDocsTool],
})
export class McpModule {}

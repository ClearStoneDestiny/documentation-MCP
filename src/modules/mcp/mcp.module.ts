import { Module } from "@nestjs/common";
import { McpService } from "./mcp.service.js";
import { DocumentationModule } from "../documentation/documentation.module.js";
import { GetDocumentationTool } from "./tools/get-documentation.tool.js";

@Module({
  imports: [DocumentationModule],
  providers: [McpService, GetDocumentationTool],
})
export class McpModule {}

import { Module } from "@nestjs/common";
import { McpService } from "./mcp.service.js";
import { DocumentationModule } from "../documentation/documentation.module.js";
import { GetDocumentationTool } from "./tools/get-documentation.tool.js";
import { SearchModule } from "../search/search.module.js";
import { SearchDocsTool } from "./tools/search-docs.tool.js";
import { LibrariesModule } from "../libraries/libraries.module.js";
import { ListVersionsTool } from "./tools/list-versions.tool.js";
import { ListLibrariesTool } from "./tools/list-libraries.tool.js";

@Module({
  imports: [DocumentationModule, SearchModule, LibrariesModule],
  providers: [
    McpService,
    GetDocumentationTool,
    SearchDocsTool,
    ListVersionsTool,
    ListLibrariesTool,
  ],
})
export class McpModule {}

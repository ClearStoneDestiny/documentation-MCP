import { Module } from "@nestjs/common";
import { McpModule } from "./modules/mcp/mcp.module.js";

@Module({
  imports: [McpModule],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { McpModule } from './modules/mcp/mcp.module.js';
import { SourcesModule } from './modules/sources/sources.module.js';

@Module({
  imports: [McpModule, SourcesModule],
})
export class AppModule {}

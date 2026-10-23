import { Module } from '@nestjs/common';
import { McpService } from './mcp.service.js';

@Module({
  providers: [McpService],
})
export class McpModule {}

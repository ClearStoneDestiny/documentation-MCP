import { readFileSync } from "node:fs";
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/server";
import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { GetDocumentationTool } from "./tools/get-documentation.tool.js";

const packageInfo = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

@Injectable()
export class McpService implements OnModuleInit, OnModuleDestroy {
  private handle?: StdioServerHandle;

  constructor(
    @Inject(GetDocumentationTool)
    private readonly getDocumentationTool: GetDocumentationTool,
  ) {}

  onModuleInit(): void {
    // The factory supports both modern MCP clients and legacy initialize handshakes
    this.handle = serveStdio(() => this.createServer(), {
      onerror: (error) => console.error("[MCP]", error),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.handle?.close();
  }

  private createServer(): McpServer {
    const server = new McpServer({
      name: packageInfo.name,
      version: packageInfo.version,
    });

    server.registerTool(
      "get_server_info",
      {
        description:
          "Get server information and the current implementation stage.",
        inputSchema: z.object({}),
        outputSchema: z.object({
          name: z.string(),
          version: z.string(),
          stage: z.literal("documentation"),
        }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        const info = {
          name: packageInfo.name,
          version: packageInfo.version,
          stage: "documentation" as const,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(info) }],
          structuredContent: info,
        };
      },
    );

    this.getDocumentationTool.register(server);
    return server;
  }
}

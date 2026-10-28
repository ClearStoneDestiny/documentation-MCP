import { McpServer } from "@modelcontextprotocol/server";
import { Inject, Injectable } from "@nestjs/common";
import { VersionService } from "../../libraries/version.service.js";
import {
  listVersionsInputSchema,
  listVersionsOutputSchema,
} from "../../libraries/schemas/list-versions.schema.js";
import { DocumentationError } from "../../documentation/errors/documentation.error.js";

@Injectable()
export class ListVersionsTool {
  constructor(
    @Inject(VersionService)
    private readonly version: VersionService,
  ) {}

  register(server: McpServer): void {
    server.registerTool(
      "list_versions",
      {
        description:
          "List documentation sets available through this server for a supported library. " +
          "Select a library from list_libraries. Only the current documentation set is supported. " +
          "Sets are discovered by the selected source adapter. Set IDs are not package release numbers. " +
          "Returns source-declared version metadata when available; this is not an " +
          "immutable documentation revision or a verified compatibility range. " +
          "refresh asks the adapter to recheck discovery sources; catalog provenance is optional. " +
          "Inspect catalog.cache when present: stale means the source could not " +
          "be checked and a saved copy was returned. " +
          "Does not list all package releases or provide historical documentation.",

        inputSchema: listVersionsInputSchema,
        outputSchema: listVersionsOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },

      async (input, context) => {
        const signal = context.mcpReq.signal;

        try {
          const result = await this.version.listVersion(input, signal);

          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error: any) {
          signal.throwIfAborted();

          if (!(error instanceof DocumentationError)) {
            console.error("[list_versions]", error);
          }

          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code:
                    error instanceof DocumentationError
                      ? error.code
                      : "INTERNAL_ERROR",

                  message:
                    error instanceof DocumentationError
                      ? error.message
                      : "Could not list documentation sets.",
                }),
              },
            ],
          };
        }
      },
    );
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/server";
import { DocumentationService } from "../../documentation/documentation.service.js";
import { DocumentationError } from "../../documentation/errors/documentation.error.js";
import {
  getDocumentationInputSchema,
  getDocumentationOutputSchema,
} from "../../documentation/schemas/get-documentation.schema.js";

@Injectable()
export class GetDocumentationTool {
  constructor(
    @Inject(DocumentationService)
    private readonly documentation: DocumentationService,
  ) {}

  register(server: McpServer): void {
    server.registerTool(
      "get_documentation",
      {
        description:
          "Fetch current official Next.js documentation by page path, optionally selecting a section and its subsections. Uses a disk cache; refresh checks the source immediately. Inspect cache.status: stale means the source could not be checked. Returns Markdown, source metadata, and section IDs. Historical versions are not supported. Use nextOffset and contentHash to continue truncated content; preserve path and section_id between pages. Code fences can span response boundaries.",
        inputSchema: getDocumentationInputSchema,
        outputSchema: getDocumentationOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (input, context) => {
        try {
          const result = await this.documentation.getDocumentation(
            input,
            context.mcpReq.signal,
          );

          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error) {
          context.mcpReq.signal.throwIfAborted();
          if (!(error instanceof DocumentationError)) {
            console.error("[get_documentation]", error);
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
                      : "Could not retrieve documentation.",
                }),
              },
            ],
          };
        }
      },
    );
  }
}

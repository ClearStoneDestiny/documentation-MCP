import { Inject, Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/server";
import { SearchError } from "../../search/errors/search.error.js";
import { SearchService } from "../../search/search.service.js";
import {
  searchDocsInputSchema,
  searchDocsOutputSchema,
} from "../../search/schemas/search-docs.schema.js";

@Injectable()
export class SearchDocsTool {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  register(server: McpServer): void {
    server.registerTool(
      "search_docs",
      {
        description:
          "Search sections of current official Next.js documentation with lexical keywords (usually English). First call downloads and indexes all pages directly listed in the root catalog, or only path_prefix; this can take time. Uses the disk cache and updates changed sections by content hash. Nested catalogs such as Pages Router are not expanded. Results include snippets and ready-to-use getDocumentation arguments for get_documentation. Inspect coverage for partial failures and stale sources. Does not compare historical versions or translate queries.",
        inputSchema: searchDocsInputSchema,
        outputSchema: searchDocsOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },

      async (input, context) => {
        try {
          const progressToken = context.mcpReq._meta?.progressToken;
          const onProgress =
            progressToken === undefined
              ? undefined
              : async (progress: number, total: number) => {
                  await context.mcpReq
                    .notify({
                      method: "notifications/progress",
                      params: {
                        progressToken,
                        progress,
                        total,
                        message: `Processed ${progress}/${total} selected documentation pages.`,
                      },
                    })
                    .catch((error: unknown) => {
                      if (!context.mcpReq.signal.aborted) {
                        console.error(
                          "[search_docs] Could not send progress:",
                          error,
                        );
                      }
                    });
                };

          const result = await this.search.searchDocs(
            input,
            context.mcpReq.signal,
            onProgress,
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error) {
          context.mcpReq.signal.throwIfAborted();

          if (!(error instanceof SearchError)) {
            console.error("[search_docs]", error);
          }

          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code:
                    error instanceof SearchError
                      ? error.code
                      : "INTERNAL_ERROR",
                  message:
                    error instanceof SearchError
                      ? error.message
                      : "Could not search documentation.",
                }),
              },
            ],
          };
        }
      },
    );
  }
}

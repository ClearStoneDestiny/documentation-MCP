import { Inject, Injectable } from "@nestjs/common";
import { LibraryService } from "../../libraries/library.service.js";
import { McpServer } from "@modelcontextprotocol/server";
import {
  listLibrariesInputSchema,
  listLibrariesOutputSchema,
} from "../../libraries/schemas/list-libraries.schema.js";
import { DocumentationError } from "../../documentation/errors/documentation.error.js";

@Injectable()
export class ListLibrariesTool {
  constructor(
    @Inject(LibraryService)
    private readonly library: LibraryService,
  ) {}

  register(server: McpServer): void {
    server.registerTool(
      "list_libraries",
      {
        description:
          "List libraries supported by this documentation server and their " +
          "available capabilities. Returns library identifiers, display names, " +
          "official documentation URLs, available tools, and whether historical " +
          "documentation can be retrieved. " +
          "Use the returned library identifier as the library argument in other tools. " +
          "Optionally filter identifiers and display names by a case-insensitive " +
          "substring. Omit the filter to list all libraries. " +
          "An empty result means no libraries matched the filter. " +
          "Reads the server registry without fetching external documentation.",

        inputSchema: listLibrariesInputSchema,
        outputSchema: listLibrariesOutputSchema,

        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },

      (input, context) => {
        const signal = context.mcpReq.signal;

        try {
          signal.throwIfAborted();

          const result = this.library.listLibraries(input);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result),
              },
            ],
            structuredContent: result,
          };
        } catch (error: unknown) {
          signal.throwIfAborted();

          if (!(error instanceof DocumentationError)) {
            console.error("[list_libraries]", error);
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
                      : "Could not list supported libraries.",
                }),
              },
            ],
          };
        }
      },
    );
  }
}

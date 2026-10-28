import { McpServer } from "@modelcontextprotocol/server";
import { Inject, Injectable } from "@nestjs/common";
import { CodeExamplesService } from "../../code-examples/code-examples.service.js";
import {
  getCodeExamplesInputSchema,
  getCodeExamplesOutputSchema,
} from "../../code-examples/schemas/get-code-examples.schema.js";
import { DocumentationError } from "../../documentation/errors/documentation.error.js";

@Injectable()
export class GetCodeExamplesTool {
  constructor(
    @Inject(CodeExamplesService) private readonly examples: CodeExamplesService,
  ) {}

  register(server: McpServer): void {
    server.registerTool(
      "get_code_examples",
      {
        description:
          "Extract complete code blocks from official documentation, ranked by lexical query keywords in code, surrounding prose and headings. " +
          "Select a library from list_libraries. version selects a documentation set ID from list_versions; only current is supported. Package release numbers are not valid selectors. " +
          "filters.languages selects fence languages; filters.path_prefix restricts downloads to an exact page or subtree. " +
          "The first call loads pages directly listed in the root catalog; nested catalogs are not expanded. " +
          "Uses the disk cache; refresh rechecks sources. Inspect coverage for partial failures and stale sources. " +
          "Returns complete code, language, section title, source URL and freshness metadata. " +
          "Use getDocumentation only when more surrounding context is needed. Examples are extracted, not generated or executed.",
        inputSchema: getCodeExamplesInputSchema,
        outputSchema: getCodeExamplesOutputSchema,
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
                      if (!signal.aborted) {
                        console.error(
                          "[get_code_examples] Could not send progress:",
                          error,
                        );
                      }
                    });
                };

          const result = await this.examples.getCodeExamples(
            input,
            signal,
            onProgress,
          );

          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error: unknown) {
          signal.throwIfAborted();

          if (!(error instanceof DocumentationError)) {
            console.error("[get_code_examples]", error);
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
                      : "Could not extract code examples.",
                }),
              },
            ],
          };
        }
      },
    );
  }
}

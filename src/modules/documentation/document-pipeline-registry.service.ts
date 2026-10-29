import { Inject, Injectable } from "@nestjs/common";
import { DOCUMENT_PIPELINES } from "./constants/document-pipelines.constant.js";
import type { IDocumentPipeline } from "./interfaces/document-pipeline.interface.js";

@Injectable()
export class DocumentPipelineRegistry {
  private readonly pipelines = new Map<string, IDocumentPipeline>();

  constructor(
    @Inject(DOCUMENT_PIPELINES) pipelines: readonly IDocumentPipeline[],
  ) {
    for (const pipeline of pipelines) {
      const hasValidFormat =
        typeof pipeline.format === "string" && Boolean(pipeline.format.trim());
      const hasValidParser = typeof pipeline.parse === "function";
      const hasValidIndexFactory =
        pipeline.createIndex === undefined ||
        typeof pipeline.createIndex === "function";

      if (
        !hasValidFormat ||
        !hasValidParser ||
        !hasValidIndexFactory ||
        this.pipelines.has(pipeline.format)
      ) {
        throw new Error(
          `Invalid or duplicate document pipeline: ${pipeline.format}`,
        );
      }

      this.pipelines.set(pipeline.format, Object.freeze({ ...pipeline }));
    }
  }

  get(format: string): IDocumentPipeline | undefined {
    return this.pipelines.get(format);
  }
}

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
      // TODO: improve readability
      if (
        typeof pipeline.format !== "string" ||
        !pipeline.format.trim() ||
        typeof pipeline.parse !== "function" ||
        (pipeline.createIndex !== undefined &&
          typeof pipeline.createIndex !== "function") ||
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

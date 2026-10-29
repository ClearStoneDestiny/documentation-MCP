import { Inject, Injectable } from "@nestjs/common";
import { CachedMarkdownService } from "../services/cached-markdown.service.js";
import { LIBRARY_SOURCE_OPTIONS } from "../constants/library-source-options.constant.js";
import type { ILibrarySourceOptions } from "../interfaces/library-source-options.interface.js";
import { NEXTJS_DOCUMENT_PATH_PATTERN } from "../constants/nextjs.constant.js";
import { LlmsMarkdownAdapter } from "./llms-markdown.adapter.js";

@Injectable()
export class NextjsAdapter extends LlmsMarkdownAdapter {
  constructor(
    @Inject(CachedMarkdownService)
    markdown: CachedMarkdownService,
    @Inject(LIBRARY_SOURCE_OPTIONS)
    source: ILibrarySourceOptions,
  ) {
    super(markdown, source);
  }

  isValidPath(path: string): boolean {
    return NEXTJS_DOCUMENT_PATH_PATTERN.test(path);
  }
}

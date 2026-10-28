import { Inject, Injectable } from "@nestjs/common";
import { ILibraryRegistration } from "./interfaces/library-registration.interface.js";
import { NextjsAdapter } from "../sources/adapters/nextjs.adapter.js";
import { NEXTJS_DOCS_BASE_URL } from "../sources/constants/nextjs.constant.js";

@Injectable()
export class LibraryRegistry {
  private readonly registrations: readonly ILibraryRegistration[];

  constructor(
    @Inject(NextjsAdapter)
    nextjs: NextjsAdapter,
  ) {
    this.registrations = [
      {
        id: nextjs.libraryId,
        name: "Next.js",
        documentationUrl: NEXTJS_DOCS_BASE_URL,

        capabilities: {
          tools: ["get_documentation", "search_docs", "list_versions"],
          historicalDocumentation: false,
        },

        adapter: nextjs,
      },
    ];
  }

  list(): readonly ILibraryRegistration[] {
    return this.registrations;
  }

  get(libraryId: string): ILibraryRegistration | undefined {
    return this.registrations.find(
      (registration) => registration.id === libraryId,
    );
  }
}

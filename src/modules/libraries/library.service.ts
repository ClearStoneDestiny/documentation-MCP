import { Inject, Injectable } from "@nestjs/common";
import { LibraryRegistry } from "./library-registry.service.js";
import {
  listLibrariesInputSchema,
  TListLibrariesInput,
  TListLibrariesResult,
} from "./schemas/list-libraries.schema.js";
import { DocumentationError } from "../documentation/errors/documentation.error.js";

@Injectable()
export class LibraryService {
  constructor(
    @Inject(LibraryRegistry)
    private readonly registry: LibraryRegistry,
  ) {}

  listLibraries(input: TListLibrariesInput): TListLibrariesResult {
    const validation = listLibrariesInputSchema.safeParse(input);

    if (!validation.success) {
      throw new DocumentationError("INVALID_REQUEST", validation.error.message);
    }

    const request = validation.data;
    const filter = request.filter?.toLowerCase();

    const registrations = this.registry.list();

    const matchingLibraries = registrations.filter((registration) => {
      if (filter === undefined) {
        return true;
      }

      return (
        registration.id.toLowerCase().includes(filter) ||
        registration.name.toLowerCase().includes(filter)
      );
    });

    return {
      libraries: matchingLibraries.map((registration) => ({
        id: registration.id,
        name: registration.name,
        documentationUrl: registration.documentationUrl,

        capabilities: {
          tools: [...registration.capabilities.tools],
          historicalDocumentation:
            registration.capabilities.historicalDocumentation,
        },
      })),
    };
  }
}

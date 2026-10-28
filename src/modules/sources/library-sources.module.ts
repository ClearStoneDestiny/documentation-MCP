import { Module, type DynamicModule } from "@nestjs/common";
import { CacheModule } from "../cache/cache.module.js";
import { CACHE_SCOPE } from "../cache/constants/cache-scope.constant.js";
import { CURRENT_DOCUMENTATION_SET_ID } from "../libraries/constants/documentation-set.constant.js";
import type { TLibraryDefinitions } from "../libraries/constants/library-definitions.constant.js";
import { LIBRARY_REGISTRATIONS } from "../libraries/constants/library-registrations.constant.js";
import { LIBRARY_ID_PATTERN } from "../libraries/constants/library.constant.js";
import type { ILibraryDefinition } from "../libraries/interfaces/library-definition.interface.js";
import type { TLibraryId } from "../libraries/interfaces/library-id.type.js";
import { createLibraryRegistration } from "../libraries/utils/create-library-registration.util.js";
import { LIBRARY_SOURCE_OPTIONS } from "./constants/library-source-options.constant.js";
import type { ISourceAdapter } from "./interfaces/source-adapter.interface.js";
import { CachedMarkdownService } from "./services/cached-markdown.service.js";
import { DocumentProcessingModule } from "../documentation/document-processing.module.js";
import { DocumentPipelineRegistry } from "../documentation/document-pipeline-registry.service.js";

// Separate scopes let multiple libraries use the same adapter class with
// different options. Nest constructs the adapters and injects their dependencies
@Module({})
class LibrarySourceModule {
  static register(
    id: TLibraryId,
    definition: ILibraryDefinition,
    token: symbol,
  ): DynamicModule {
    return {
      module: LibrarySourceModule,
      imports: [CacheModule],
      providers: [
        CachedMarkdownService,
        {
          provide: CACHE_SCOPE,
          useValue: Object.freeze({
            libraryId: id,
            documentationSetId: CURRENT_DOCUMENTATION_SET_ID,
          }),
        },
        {
          provide: LIBRARY_SOURCE_OPTIONS,
          useValue: Object.freeze({
            id,
            documentationUrl: definition.documentationUrl,
            sources: definition.sources,
          }),
        },
        { provide: token, useClass: definition.adapter },
      ],
      exports: [token],
    };
  }
}

@Module({})
export class LibrarySourcesModule {
  static register(definitions: TLibraryDefinitions): DynamicModule {
    const enabled = Object.entries(definitions).flatMap(([id, definition]) => {
      validateDefinition(id, definition);

      if (!definition.enabled) {
        return [];
      }

      const snapshot: ILibraryDefinition = Object.freeze({
        ...definition,
        sources: Object.freeze({
          ...definition.sources,
          ...(definition.sources.catalog
            ? { catalog: Object.freeze({ ...definition.sources.catalog }) }
            : {}),
        }),
      });
      return [{ id, definition: snapshot, token: Symbol(id) }];
    });

    const imports = enabled.map(({ id, definition, token }) =>
      LibrarySourceModule.register(id, definition, token),
    );

    return {
      module: LibrarySourcesModule,
      imports: [...imports, DocumentProcessingModule],
      providers: [
        {
          provide: LIBRARY_REGISTRATIONS,
          inject: [
            DocumentPipelineRegistry,
            ...enabled.map(({ token }) => token),
          ],
          useFactory: (
            pipelines: DocumentPipelineRegistry,
            ...adapters: ISourceAdapter[]
          ) =>
            Object.freeze(
              enabled.map(({ id, definition }, index) =>
                createLibraryRegistration(
                  id,
                  definition,
                  adapters[index]!,
                  pipelines,
                ),
              ),
            ),
        },
      ],
      exports: [LIBRARY_REGISTRATIONS],
    };
  }
}

function validateDefinition(id: string, definition: ILibraryDefinition): void {
  const invalid = () => {
    return new Error(`Invalid library definition: ${id}`);
  };

  // TODO: improve readability of condition
  if (
    !LIBRARY_ID_PATTERN.test(id) ||
    id.length > 100 ||
    !definition ||
    typeof definition.enabled !== "boolean" ||
    typeof definition.name !== "string" ||
    !definition.name.trim() ||
    typeof definition.adapter !== "function" ||
    !definition.adapter.prototype ||
    !definition.sources ||
    typeof definition.sources !== "object"
  ) {
    throw invalid();
  }

  for (const value of [
    definition.documentationUrl,
    ...(definition.sources.catalog ? [definition.sources.catalog.url] : []),
  ]) {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      throw invalid();
    }
    // TODO: improve readability
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw invalid();
    }
  }
  //TODO: improve readability
  if (
    !definition.documentationUrl.endsWith("/") ||
    new URL(definition.documentationUrl).search ||
    (definition.sources.catalog &&
      definition.sources.catalog.format !== "llms-txt")
  ) {
    throw invalid();
  }
}

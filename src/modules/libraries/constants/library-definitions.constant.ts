import { NextjsAdapter } from "../../sources/adapters/nextjs.adapter.js";
import {
  NEXTJS_CATALOG_URL,
  NEXTJS_DOCS_BASE_URL,
} from "../../sources/constants/nextjs.constant.js";
import type { ILibraryDefinition } from "../interfaces/library-definition.interface.js";

export const LIBRARY_DEFINITIONS = {
  nextjs: {
    enabled: true,
    name: "Next.js",
    documentationUrl: NEXTJS_DOCS_BASE_URL,
    sources: {
      catalog: { format: "llms-txt", url: NEXTJS_CATALOG_URL },
    },
    adapter: NextjsAdapter,
  },
} as const satisfies Record<string, ILibraryDefinition>;

export type TLibraryDefinitions = Readonly<
  Partial<Record<keyof typeof LIBRARY_DEFINITIONS, ILibraryDefinition>>
>;

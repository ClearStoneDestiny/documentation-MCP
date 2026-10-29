import { NextjsAdapter } from "../../sources/adapters/nextjs.adapter.js";
import { ReactAdapter } from "../../sources/adapters/react.adapter.js";
import {
  REACT_CATALOG_URL,
  REACT_DOCS_BASE_URL,
} from "../../sources/constants/react.constant.js";
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

  react: {
    enabled: true,
    name: "React",
    documentationUrl: REACT_DOCS_BASE_URL,
    sources: {
      catalog: { format: "llms-txt", url: REACT_CATALOG_URL },
    },
    adapter: ReactAdapter,
  },
} as const satisfies Record<string, ILibraryDefinition>;

export type TLibraryDefinitions = Readonly<Record<string, ILibraryDefinition>>;

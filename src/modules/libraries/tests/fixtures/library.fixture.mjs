import { LIBRARY_DEFINITIONS } from "../../../../../dist/modules/libraries/constants/library-definitions.constant.js";
import { LibraryRegistry } from "../../../../../dist/modules/libraries/library-registry.service.js";
import { createLibraryRegistration } from "../../../../../dist/modules/libraries/utils/create-library-registration.util.js";

export const nextjsSourceOptions = {
  id: "nextjs",
  documentationUrl: LIBRARY_DEFINITIONS.nextjs.documentationUrl,
  sources: LIBRARY_DEFINITIONS.nextjs.sources,
};

export function createRegistry(adapter) {
  return new LibraryRegistry([
    createLibraryRegistration("nextjs", LIBRARY_DEFINITIONS.nextjs, adapter),
  ]);
}

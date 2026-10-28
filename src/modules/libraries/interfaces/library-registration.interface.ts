import { ISourceAdapter } from "../../sources/interfaces/source-adapter.interface.js";
import { TLibraryId } from "./library-id.type.js";
import { TLibraryToolName } from "./library-tool-name.type.js";

export interface ILibraryRegistration {
  readonly id: TLibraryId;
  readonly name: string;
  readonly documentationUrl: string;

  readonly capabilities: {
    readonly tools: readonly TLibraryToolName[];
    readonly historicalDocumentation: boolean;
  };

  readonly adapter: ISourceAdapter;
}

import type { Type } from "@nestjs/common";
import type { ISourceAdapter } from "../../sources/interfaces/source-adapter.interface.js";
import type { ILibrarySourceOptions } from "../../sources/interfaces/library-source-options.interface.js";

export interface ILibraryDefinition {
  readonly enabled: boolean;
  readonly name: string;
  readonly documentationUrl: string;
  readonly sources: ILibrarySourceOptions["sources"];
  readonly adapter: Type<ISourceAdapter>;
}

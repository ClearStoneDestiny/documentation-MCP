export interface ILibrarySourceOptions {
  readonly id: string;
  readonly name: string;
  readonly documentationUrl: string;
  readonly sources: {
    readonly catalog?: {
      readonly format: "llms-txt";
      readonly url: string;
    };
  };
}

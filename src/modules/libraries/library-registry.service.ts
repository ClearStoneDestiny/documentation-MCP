import { Inject, Injectable } from "@nestjs/common";
import { ILibraryRegistration } from "./interfaces/library-registration.interface.js";
import { LIBRARY_REGISTRATIONS } from "./constants/library-registrations.constant.js";

@Injectable()
export class LibraryRegistry {
  private readonly registrations: readonly ILibraryRegistration[];

  constructor(
    @Inject(LIBRARY_REGISTRATIONS)
    registrations: readonly ILibraryRegistration[],
  ) {
    this.registrations = Object.freeze([...registrations]);
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

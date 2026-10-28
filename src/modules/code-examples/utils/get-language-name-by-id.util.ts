export function getLanguageNameById(language: string): string {
  const id = language.toLowerCase();

  if (id === "js") {
    return "javascript";
  }

  if (id === "ts") {
    return "typescript";
  }

  return id;
}

import type { FileRead } from "../types.js";

/** One doc in a tool response: content, or a structured miss with a hint. */
export type DocSection =
  | { path: string; found: true; content: string }
  | { path: string; found: false; hint: string };

/** Convert a FileRead into a DocSection for tool responses. */
export function toSection(read: FileRead): DocSection {
  return read.found
    ? { path: read.path, found: true, content: read.content }
    : { path: read.path, found: false, hint: read.hint };
}

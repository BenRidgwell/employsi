// Types for JSON that arrives from outside the app — third-party job boards
// (Adzuna, The Muse, Jooble, MyCareersFuture, SEEK), Yahoo Finance, government
// job feeds, and the Cloudflare Workers `env` binding bag.
//
// None of these have a schema we control, and their responses change without
// notice, so the code reads them defensively: pull a field, coerce it, fall
// back. That pattern used to be written against `any`, which silently switched
// off type checking for everything downstream of the parse — a typo in a field
// name produced `undefined` at runtime rather than an error at build time.
//
// `JsonRecord` keeps the same defensive style (indexing an unknown key is
// allowed and yields `JsonValue`) while still catching the things that matter:
// you cannot call a method on a parsed value, or pass one somewhere a string is
// required, without coercing it first.
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

/** Narrow an unknown parse result to an object, or an empty one. */
export function asRecord(v: unknown): JsonRecord {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : {};
}

/** Narrow an unknown parse result to an array of objects, or an empty one. */
export function asRecords(v: unknown): JsonRecord[] {
  return Array.isArray(v)
    ? v.filter((x) => x && typeof x === "object").map((x) => x as JsonRecord)
    : [];
}

/** Coerce any parsed value to a trimmed string ('' for null/undefined). */
export function str(v: JsonValue | undefined): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Coerce any parsed value to a finite number, or undefined. */
export function num(v: JsonValue | undefined): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

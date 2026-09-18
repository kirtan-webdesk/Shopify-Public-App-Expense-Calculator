// Identifier shape check for route params / query strings that name a stored
// row (e.g. /app/history/:id, /app/calculator?from=:id).
//
// Why this exists: Postgres rejects a malformed value for a UUID-typed column
// with a syntax error (SQLSTATE 22P02), which would surface as a 500 that is
// distinguishable from a clean "not found" — and a distinguishable response
// is an existence oracle. Anything that is not a UUID is treated exactly like
// an id that matches no row: the caller answers "not found" without ever
// building a query from it.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

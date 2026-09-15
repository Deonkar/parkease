/**
 * PostgreSQL SQLSTATE codes the write paths react to by name. The exception
 * filter maps these to HTTP status codes generically; a command catches one only
 * when it has a *domain* answer better than the generic mapping.
 */
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

interface PgErrorShape {
  readonly code: string;
  readonly constraint_name?: string;
}

/** Guards against a self-referential `cause` chain turning a lookup into a hang. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Walks the `cause` chain looking for the driver's error.
 *
 * Drizzle does not rethrow postgres.js errors as-is: it wraps them in a
 * `DrizzleQueryError` carrying the original as `cause`. Checking only the
 * top-level object therefore never sees a SQLSTATE, which would quietly turn
 * every lost slot race — a 409 the driver is meant to read as "someone beat you
 * to it" — into a 500. Integration tests caught exactly that.
 */
function findPgError(error: unknown): PgErrorShape | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== 'object' || current === null) return undefined;

    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint_name === 'string'
          ? { constraint_name: candidate.constraint_name }
          : {}),
      };
    }

    current = candidate.cause;
  }

  return undefined;
}

/**
 * A narrowing guard, not a cast: `error as PgError` on an arbitrary thrown value
 * is exactly what R-VAL-01 forbids.
 */
export function isPgError(error: unknown, code: string): boolean {
  return findPgError(error)?.code === code;
}

/** The constraint that fired, for the log line. Never for the user (R-GEN-06). */
export function pgConstraintName(error: unknown): string | undefined {
  return findPgError(error)?.constraint_name;
}

/**
 * The SQLSTATE of the driver error anywhere in the `cause` chain, for the
 * exception filter's generic mapping. Undefined for anything that is not a
 * database error.
 */
export function pgSqlState(error: unknown): string | undefined {
  return findPgError(error)?.code;
}

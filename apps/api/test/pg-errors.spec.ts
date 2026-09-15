import { describe, expect, it } from 'vitest';

import {
  PG_EXCLUSION_VIOLATION,
  isPgError,
  pgConstraintName,
  pgSqlState,
} from '../src/platform/db/errors.js';

/** What postgres.js actually throws. */
const pgError = (code: string, constraint?: string): Error =>
  Object.assign(new Error('conflicting key value violates exclusion constraint'), {
    code,
    ...(constraint === undefined ? {} : { constraint_name: constraint }),
  });

/**
 * What Drizzle rethrows: its own error carrying the driver's as `cause`. This is
 * the shape that reaches a command's catch block, and reading only the top level
 * of it turned every lost slot race into a 500 until an integration test caught
 * it. These assertions exist so that cannot come back.
 */
const drizzleWrapped = (inner: Error): Error =>
  Object.assign(new Error('Failed query: insert into "booking_slots" ...'), { cause: inner });

describe('pg error inspection', () => {
  it('recognises the driver error directly', () => {
    expect(isPgError(pgError(PG_EXCLUSION_VIOLATION), PG_EXCLUSION_VIOLATION)).toBe(true);
  });

  it('recognises it through one layer of wrapping', () => {
    const wrapped = drizzleWrapped(pgError(PG_EXCLUSION_VIOLATION));
    expect(isPgError(wrapped, PG_EXCLUSION_VIOLATION)).toBe(true);
  });

  it('recognises it through several layers of wrapping', () => {
    const deep = drizzleWrapped(drizzleWrapped(pgError(PG_EXCLUSION_VIOLATION)));
    expect(isPgError(deep, PG_EXCLUSION_VIOLATION)).toBe(true);
  });

  it('does not match a different SQLSTATE', () => {
    expect(isPgError(drizzleWrapped(pgError('23505')), PG_EXCLUSION_VIOLATION)).toBe(false);
  });

  it('reports the constraint name from the wrapped error, for the log line', () => {
    const wrapped = drizzleWrapped(pgError(PG_EXCLUSION_VIOLATION, 'booking_slots_no_overlap'));
    expect(pgConstraintName(wrapped)).toBe('booking_slots_no_overlap');
  });

  it('returns undefined for an error that is not a database error', () => {
    expect(pgSqlState(new Error('just an error'))).toBeUndefined();
    expect(pgConstraintName(new Error('just an error'))).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
    ['a number', 42],
  ])('survives being handed %s', (_label, value) => {
    expect(isPgError(value, PG_EXCLUSION_VIOLATION)).toBe(false);
    expect(pgSqlState(value)).toBeUndefined();
  });

  it('terminates on a self-referential cause chain rather than hanging', () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isPgError(loop, PG_EXCLUSION_VIOLATION)).toBe(false);
  });
});

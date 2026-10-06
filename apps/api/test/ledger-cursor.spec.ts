import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  decodeLedgerCursor,
  encodeLedgerCursor,
} from '../src/domains/ledger/queries/ledger-explorer.js';

const ID = '0192f1c0-0000-7000-8000-000000000001';
const cursorOf = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');

describe('ledger explorer cursor', () => {
  it('round-trips a real instant at microsecond precision', () => {
    const cursor = { occurredAt: '2026-10-06T10:11:12.123456Z', id: ID };
    expect(decodeLedgerCursor(encodeLedgerCursor(cursor))).toEqual(cursor);
  });

  it('accepts the last day of a leap February', () => {
    expect(() => decodeLedgerCursor(cursorOf(`2028-02-29T00:00:00.000000Z|${ID}`))).not.toThrow();
  });

  it.each([
    ['month 99', `9999-99-99T99:99:99.000000Z|${ID}`],
    ['30 February', `2026-02-30T00:00:00.000000Z|${ID}`],
    ['29 February in a common year', `2027-02-29T00:00:00.000000Z|${ID}`],
    ['hour 24', `2026-10-06T24:00:00.000000Z|${ID}`],
    ['minute 60', `2026-10-06T10:60:00.000000Z|${ID}`],
    ['not a timestamp at all', `not-a-timestamp-at-all-xxxxxx|${ID}`],
    ['no separator', '2026-10-06T10:11:12.123456Z'],
    ['an extra field', `2026-10-06T10:11:12.123456Z|${ID}|x`],
    ['a bad id', '2026-10-06T10:11:12.123456Z|nope'],
    ['empty', ''],
  ])('rejects %s as a ZodError (a 400, never a database error)', (_label, text) => {
    expect(() => decodeLedgerCursor(cursorOf(text))).toThrow(ZodError);
  });

  it('rejects a cursor that is not base64url at all', () => {
    expect(() => decodeLedgerCursor('%%%not base64%%%')).toThrow(ZodError);
  });
});

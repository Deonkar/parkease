import { describe, expect, it } from 'vitest';

import { recoveryFor, toApiFailure } from '../api/errors';

/** What axios actually rejects with when the server answered. */
const withResponse = (status: number, data: unknown): unknown => ({
  response: { status, data },
  request: {},
});

/** What axios rejects with when the request went out and nothing came back. */
const noResponse = (): unknown => ({ request: {} });

const envelope = (code: string, message: string) => ({
  error: { code, message, traceId: 'trace-1' },
});

describe('toApiFailure', () => {
  it('reads the API error envelope', () => {
    const failure = toApiFailure(
      withResponse(409, envelope('SLOT_UNAVAILABLE', 'This spot was just booked by someone else.')),
    );

    expect(failure.code).toBe('SLOT_UNAVAILABLE');
    expect(failure.status).toBe(409);
    expect(failure.traceId).toBe('trace-1');
    expect(failure.message).toContain('just booked');
  });

  /**
   * The case this exists for. A proxy error page, a gateway timeout HTML body,
   * a truncated response — anything that is not our envelope must still produce
   * a sentence a human can read, not `undefined` rendered into the screen
   * (R-FAIL-01, R-VAL-01).
   */
  it.each([
    ['an HTML error page', '<html><body>502 Bad Gateway</body></html>'],
    ['an empty body', ''],
    ['a bare string', 'nope'],
    ['a half-shaped envelope', { error: { code: 'X' } }],
    ['null', null],
    ['an array', [1, 2, 3]],
  ])('falls back to a readable message for %s', (_label, body) => {
    const failure = toApiFailure(withResponse(502, body));

    expect(failure.code).toBe('UNKNOWN');
    expect(failure.message.length).toBeGreaterThan(0);
    expect(failure.message).not.toContain('undefined');
    expect(failure.status).toBe(502);
  });

  it('distinguishes a network failure from a server error', () => {
    const failure = toApiFailure(noResponse());

    expect(failure.code).toBe('NETWORK');
    expect(failure.message).toMatch(/connection/i);
    expect(failure.status).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
    ['a number', 42],
  ])('survives being handed %s', (_label, thrown) => {
    const failure = toApiFailure(thrown);
    expect(failure.code).toBe('UNKNOWN');
    expect(failure.message.length).toBeGreaterThan(0);
  });
});

describe('recoveryFor', () => {
  /**
   * A refusal with no way forward is what makes a legitimate 409 feel like a
   * defect. Every failure the booking flow knows about carries its next step.
   */
  it.each([
    ['SLOT_UNAVAILABLE', 'back-to-search'],
    ['EXTENSION_CONFLICT', 'find-another-spot'],
    ['NETWORK', 'retry'],
    ['CONFLICT_RETRY', 'retry'],
  ])('%s offers %s', (code, expected) => {
    expect(recoveryFor({ code, message: '', traceId: undefined, status: 409 })).toBe(expected);
  });

  it('offers nothing for a failure with no known next step', () => {
    expect(
      recoveryFor({ code: 'SPACE_NOT_BOOKABLE', message: '', traceId: undefined, status: 409 }),
    ).toBe('none');
  });
});

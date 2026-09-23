import { describe, expect, it } from 'vitest';

import { apiErrorCodeOf, isUnregisteredWasher } from '../api/errors';

const httpError = (status: number, data: unknown) => ({
  isAxiosError: true,
  response: { status, data },
});

describe('apiErrorCodeOf', () => {
  it('reads the code out of the API envelope', () => {
    const error = httpError(409, {
      error: { code: 'WASH_JOB_TAKEN', message: 'taken', traceId: 't' },
    });

    expect(apiErrorCodeOf(error)).toBe('WASH_JOB_TAKEN');
  });

  it('is null for a transport failure with no response', () => {
    expect(apiErrorCodeOf(new Error('Network Error'))).toBe(null);
  });

  it('is null for a body that is not the envelope', () => {
    expect(apiErrorCodeOf(httpError(502, '<html>Bad gateway</html>'))).toBe(null);
  });
});

/**
 * `GET /washer/profile` answers 404 for a washer who has not registered yet.
 * That is a normal first-run state, not an error — but only when it is the
 * API's own 404. A proxy's 404 page is a broken deployment, and telling that
 * partner to "finish setting up" would send them in a loop.
 */
describe('isUnregisteredWasher', () => {
  it("is true for the API's own 404", () => {
    const error = httpError(404, {
      error: { code: 'NOT_FOUND', message: 'Not Found', traceId: 't' },
    });

    expect(isUnregisteredWasher(error)).toBe(true);
  });

  it('is false for a 404 with no envelope', () => {
    expect(isUnregisteredWasher(httpError(404, 'Not Found'))).toBe(false);
  });

  it('is false for any other status', () => {
    const error = httpError(500, {
      error: { code: 'NOT_FOUND', message: 'x', traceId: 't' },
    });

    expect(isUnregisteredWasher(error)).toBe(false);
  });

  it('is false for a transport failure, and for nothing at all', () => {
    expect(isUnregisteredWasher(new Error('timeout'))).toBe(false);
    expect(isUnregisteredWasher(null)).toBe(false);
  });
});

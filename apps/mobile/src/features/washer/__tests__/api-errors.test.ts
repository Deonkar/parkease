import { describe, expect, it } from 'vitest';

import { apiErrorCodeOf, isDefiniteRefusal, isUnregisteredWasher } from '../api/errors';

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
  // The REAL envelope `GET /washer/profile` answers, pinned server-side by
  // carwash-http.spec.ts ("GET /washer/profile — before registering"). The first
  // version of this fixture invented a `NOT_FOUND` code no Nest exception emits,
  // and passed while every unregistered washer saw an error screen.
  const unregistered = {
    error: {
      code: 'WASHER_PROFILE_NOT_FOUND',
      message: 'Finish setting up your partner profile before going online.',
      traceId: '0192f2a1-0000-7000-8000-00000000abcd',
    },
  };

  it("is true for the API's own 404", () => {
    expect(isUnregisteredWasher(httpError(404, unregistered))).toBe(true);
  });

  it("is false for a bare Nest 404, whose code is 'ERROR'", () => {
    const bare = { error: { code: 'ERROR', message: 'Not Found', traceId: 't' } };

    expect(isUnregisteredWasher(httpError(404, bare))).toBe(false);
  });

  it('is false for a 404 with no envelope', () => {
    expect(isUnregisteredWasher(httpError(404, 'Not Found'))).toBe(false);
  });

  it('is false for any other status', () => {
    const error = httpError(500, unregistered);

    expect(isUnregisteredWasher(error)).toBe(false);
  });

  it('is false for a transport failure, and for nothing at all', () => {
    expect(isUnregisteredWasher(new Error('timeout'))).toBe(false);
    expect(isUnregisteredWasher(null)).toBe(false);
  });
});

/**
 * Whether pressing Accept again could possibly work. A definite refusal (the
 * offer is gone, the service is not on this partner's menu) must not be met
 * with "Please try again"; a dead network or a 5xx must.
 */
describe('isDefiniteRefusal', () => {
  it('is true for a 4xx the server answered', () => {
    expect(isDefiniteRefusal(httpError(404, { error: { code: 'ERROR' } }))).toBe(true);
    expect(isDefiniteRefusal(httpError(400, { error: { code: 'SERVICE_NOT_OFFERED' } }))).toBe(
      true,
    );
  });

  it('is false for a 5xx, which a retry may clear', () => {
    expect(isDefiniteRefusal(httpError(503, 'Service Unavailable'))).toBe(false);
  });

  it('is false for a rate limit or a request timeout, which are transient', () => {
    expect(isDefiniteRefusal(httpError(429, {}))).toBe(false);
    expect(isDefiniteRefusal(httpError(408, {}))).toBe(false);
  });

  it('is false for a transport failure with no response at all', () => {
    expect(isDefiniteRefusal(new Error('Network Error'))).toBe(false);
  });

  it('is false while the first attempt is still running (409 REQUEST_IN_FLIGHT)', () => {
    // The first attempt may yet win, so the intent is kept for a replay.
    const inFlight = httpError(409, {
      error: { code: 'REQUEST_IN_FLIGHT', message: 'still processing', traceId: 't' },
    });
    expect(isDefiniteRefusal(inFlight)).toBe(false);
  });

  it('is still true for any other 409, which is a real answer', () => {
    expect(isDefiniteRefusal(httpError(409, { error: { code: 'WASH_JOB_TAKEN' } }))).toBe(true);
  });
});

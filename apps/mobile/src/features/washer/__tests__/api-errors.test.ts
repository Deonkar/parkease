import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  IN_FLIGHT_COPY,
  OUTDATED_COPY,
  apiErrorCodeOf,
  classifyFailure,
  failureCopy,
  isDefiniteRefusal,
  isUnregisteredWasher,
  loadFailureCopy,
  serverMessageOf,
  settlesIntent,
} from '../api/errors';

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

/**
 * G1: every failure is classified in ONE place, and each class is told
 * truthfully. A 2xx whose body fails its parse is not a network problem: the
 * server answered in a shape this build does not know, so the app is out of
 * date. Telling that partner to "check your connection" sends them to fix a
 * connection that works.
 */
describe('classifyFailure', () => {
  const outdated = () => {
    try {
      z.object({ data: z.object({ id: z.string() }) }).parse({ data: { id: 7 } });
    } catch (error) {
      return error;
    }
    throw new Error('the parse above must throw');
  };

  it('reads a ZodError as an out-of-date app', () => {
    expect(classifyFailure(outdated())).toBe('outdated');
  });

  it('reads REQUEST_IN_FLIGHT as the first attempt still running', () => {
    const inFlight = httpError(409, { error: { code: 'REQUEST_IN_FLIGHT', message: 'm' } });
    expect(classifyFailure(inFlight)).toBe('in-flight');
  });

  it('reads a definite 4xx as refused', () => {
    expect(classifyFailure(httpError(409, { error: { code: 'WASH_JOB_TAKEN' } }))).toBe('refused');
    expect(classifyFailure(httpError(404, 'Not Found'))).toBe('refused');
  });

  it('reads transport failures, 5xx, 408 and 429 as unreachable', () => {
    expect(classifyFailure(new Error('Network Error'))).toBe('unreachable');
    expect(classifyFailure(httpError(503, 'down'))).toBe('unreachable');
    expect(classifyFailure(httpError(429, {}))).toBe('unreachable');
    expect(classifyFailure(httpError(408, {}))).toBe('unreachable');
  });

  it('never calls an out-of-date app a refusal: the server did answer 2xx', () => {
    expect(isDefiniteRefusal(outdated())).toBe(false);
  });
});

describe('settlesIntent', () => {
  it('drops the key for a refusal and for an out-of-date app', () => {
    expect(settlesIntent(httpError(400, { error: { code: 'VALIDATION_FAILED' } }))).toBe(true);
    expect(settlesIntent(new z.ZodError([]))).toBe(true);
  });

  it('keeps the key while the first attempt may still land', () => {
    expect(settlesIntent(new Error('Network Error'))).toBe(false);
    expect(settlesIntent(httpError(409, { error: { code: 'REQUEST_IN_FLIGHT' } }))).toBe(false);
  });
});

describe('the copy each class gets', () => {
  const copy = { refused: 'refused copy', unreachable: 'offline copy' };

  it('says "Update the app" for an out-of-date app, never "check your connection"', () => {
    const said = failureCopy(new z.ZodError([]), copy);
    expect(said).toBe(OUTDATED_COPY);
    expect(said).toMatch(/Update the app to continue/);
    expect(said).not.toMatch(/connection/i);
  });

  it('says the first attempt is still being processed for REQUEST_IN_FLIGHT', () => {
    const said = failureCopy(httpError(409, { error: { code: 'REQUEST_IN_FLIGHT' } }), copy);
    expect(said).toBe(IN_FLIGHT_COPY);
    expect(said).toMatch(/still being processed/);
    expect(said).not.toMatch(/connection/i);
  });

  it('hands the other two classes the caller s own words', () => {
    expect(failureCopy(httpError(400, { error: { code: 'X' } }), copy)).toBe('refused copy');
    expect(failureCopy(new Error('Network Error'), copy)).toBe('offline copy');
  });

  it('gives a load failure its truth: out of date, or the connection', () => {
    expect(loadFailureCopy(new z.ZodError([]))).toBe(OUTDATED_COPY);
    expect(loadFailureCopy(new Error('Network Error'))).toBe(
      'Check your connection and try again.',
    );
  });
});

describe('serverMessageOf', () => {
  it('reads the envelope s message', () => {
    const error = httpError(403, { error: { code: 'WASHER_NOT_VERIFIED', message: 'Wait.' } });
    expect(serverMessageOf(error)).toBe('Wait.');
  });

  it('is null without an envelope message', () => {
    expect(serverMessageOf(httpError(404, 'Not Found'))).toBeNull();
    expect(serverMessageOf(new Error('x'))).toBeNull();
  });
});

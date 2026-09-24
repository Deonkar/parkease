import { afterEach, describe, expect, it, vi } from 'vitest';

import { summariseError, warn } from '../log';

/**
 * A bearer token must never reach a log line.
 *
 * `lib/api.ts` sets `Authorization: Bearer <accessToken>` on every request, and
 * axios attaches that same `config` object to the `AxiosError` it throws. So
 * handing a raw axios error to `console.warn` prints a live access token —
 * which on a release build reaches Logcat, and reaches any crash reporter that
 * hooks `console.warn`.
 *
 * Found by the security review lens. Nothing else catches it: `error` is typed
 * `unknown`, so neither the compiler nor eslint has anything to object to.
 */
function axiosLikeError(token: string) {
  return {
    name: 'AxiosError',
    message: 'Request failed with status code 401',
    code: 'ERR_BAD_REQUEST',
    config: {
      url: '/valet/availability',
      method: 'patch',
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': 'abc' },
    },
    response: {
      status: 401,
      config: { headers: { Authorization: `Bearer ${token}` } },
      data: { error: { code: 'UNAUTHORIZED' } },
    },
  };
}

describe('warn', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const captured = () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return {
      spy,
      output: () => spy.mock.calls.map((call) => JSON.stringify(call)).join(' '),
    };
  };

  it('never emits an access token from an axios error', () => {
    const { output } = captured();

    warn('valet.postFix: refused', axiosLikeError('super-secret-access-token'));

    expect(output()).not.toContain('super-secret-access-token');
    expect(output()).not.toContain('Bearer');
  });

  it('never emits the Authorization header itself', () => {
    const { output } = captured();

    warn('boom', axiosLikeError('t0ken'));

    expect(output()).not.toContain('Authorization');
  });

  it('still says enough to diagnose the failure', () => {
    const { output } = captured();

    warn('valet.postFix: refused', axiosLikeError('t0ken'));

    const text = output();
    expect(text).toContain('valet.postFix: refused');
    expect(text).toContain('AxiosError');
    expect(text).toContain('401');
    expect(text).toContain('ERR_BAD_REQUEST');
  });

  it('handles a plain Error without losing its message', () => {
    const { output } = captured();

    warn('something failed', new Error('disk is full'));

    expect(output()).toContain('disk is full');
  });

  it('handles a thrown non-error without crashing the caller', () => {
    const { output } = captured();

    expect(() => {
      warn('odd', 'just a string');
    }).not.toThrow();
    expect(output()).toContain('odd');
  });

  it('logs a bare message with no error', () => {
    const { spy } = captured();

    warn('nothing attached');

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

/**
 * G8: R-FAIL-01 is "log at warn+ WITH the trace id". The server's envelope
 * carries the domain code and the trace id that finds the request in the API's
 * logs; both are allowed through. Nothing else in `response.data` is.
 */
describe('the server s code and trace id', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const envelopeError = () => ({
    name: 'AxiosError',
    message: 'Request failed with status code 409',
    config: { url: '/washer/jobs/1/accept', headers: { Authorization: 'Bearer secret-token' } },
    response: {
      status: 409,
      data: {
        error: {
          code: 'WASH_JOB_TAKEN',
          message: 'taken',
          traceId: '0192f2a1-0000-7000-8000-00000000abcd',
          detail: { phone: '+919876543210' },
        },
      },
    },
  });

  it('keeps the API error code and the trace id', () => {
    const summary = summariseError(envelopeError());
    expect(summary).toMatchObject({
      apiCode: 'WASH_JOB_TAKEN',
      traceId: '0192f2a1-0000-7000-8000-00000000abcd',
      status: 409,
    });
  });

  it('keeps every other redaction: no token, no body fields beyond the two', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warn('accept failed', envelopeError());
    const out = JSON.stringify(spy.mock.calls);
    expect(out).toContain('0192f2a1-0000-7000-8000-00000000abcd');
    expect(out).not.toContain('secret-token');
    expect(out).not.toContain('+919876543210');
    expect(out).not.toContain('"taken"');
  });

  it('ignores a code or trace id that is not a string', () => {
    const summary = summariseError({
      response: { status: 500, data: { error: { code: 7, traceId: { x: 1 } } } },
    });
    expect(summary).toEqual({ status: 500 });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { warn } from '../log';

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

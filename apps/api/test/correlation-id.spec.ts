import { describe, it, expect, vi } from 'vitest';

import {
  correlationIdMiddleware,
  correlationStore,
} from '../src/platform/http/correlation-id.middleware.js';

function makeFastifyPair(headers: Record<string, string> = {}) {
  const setHeaders: Record<string, string> = {};
  return {
    request: { headers } as never,
    reply: {
      header: vi.fn((name: string, value: string) => {
        setHeaders[name] = value;
      }),
    } as never,
    getSetHeader: (name: string) => setHeaders[name],
  };
}

describe('correlationIdMiddleware', () => {
  it('mints a new id when none supplied', () => {
    const { request, reply, getSetHeader } = makeFastifyPair();
    let capturedId: string | undefined;

    correlationIdMiddleware(request, reply, () => {
      capturedId = correlationStore.getStore()?.correlationId;
    });

    expect(capturedId).toBeDefined();
    expect(getSetHeader('x-correlation-id')).toBe(capturedId);
  });

  it('echoes back a supplied x-correlation-id', () => {
    const { request, reply, getSetHeader } = makeFastifyPair({
      'x-correlation-id': 'my-trace-abc',
    });
    let capturedId: string | undefined;

    correlationIdMiddleware(request, reply, () => {
      capturedId = correlationStore.getStore()?.correlationId;
    });

    expect(capturedId).toBe('my-trace-abc');
    expect(getSetHeader('x-correlation-id')).toBe('my-trace-abc');
  });

  it('ignores empty x-correlation-id', () => {
    const { request, reply, getSetHeader } = makeFastifyPair({
      'x-correlation-id': '',
    });
    let capturedId: string | undefined;

    correlationIdMiddleware(request, reply, () => {
      capturedId = correlationStore.getStore()?.correlationId;
    });

    expect(capturedId).toBeDefined();
    expect(capturedId).not.toBe('');
    expect(getSetHeader('x-correlation-id')).toBe(capturedId);
  });
});

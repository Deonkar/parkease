import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';

import { AllExceptionsFilter } from '../src/platform/http/exception.filter.js';
import { parseOutgoing } from '../src/platform/http/outgoing-contract.js';

/**
 * Silent failure M9 (task 14 final fix wave). The global filter maps every
 * ZodError to `400 VALIDATION_FAILED`, which is right for a request and wrong
 * for a response: a row the SERVER built that fails its own contract is our
 * bug, and a 400 blames the caller and never trips a 5xx alert. `parseOutgoing`
 * is how a response parse says which side it is on.
 */
describe('parseOutgoing', () => {
  const view = z.object({ netPaise: z.number().int() });

  it('returns the parsed value when the row honours its contract', () => {
    expect(parseOutgoing(view, { netPaise: 100 }, 'test view')).toEqual({ netPaise: 100 });
  });

  it('throws a 500 carrying the ZodError as its cause, not the ZodError itself', () => {
    const thrown = (() => {
      try {
        parseOutgoing(view, { netPaise: null }, 'test view');
        return undefined;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown).not.toBeInstanceOf(ZodError);
    expect((thrown as HttpException).getStatus()).toBe(500);
    expect((thrown as HttpException).cause).toBeInstanceOf(ZodError);
  });

  it('reaches the client as 500 INTERNAL_ERROR with a generic message', () => {
    const send = vi.fn();
    const status = vi.fn().mockReturnValue({ send });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as never;

    try {
      parseOutgoing(view, { netPaise: 'not a number' }, 'test view');
    } catch (error: unknown) {
      new AllExceptionsFilter().catch(error, host);
    }

    expect(status).toHaveBeenCalledWith(500);
    const [body] = send.mock.calls[0] as [{ error: { code: string; message: string } }];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // Nothing about the schema or the row: that is in the log, with the trace id.
    expect(body.error.message).not.toMatch(/netPaise|test view|number/i);
  });
});

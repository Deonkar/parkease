import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import { AllExceptionsFilter } from '../src/platform/http/exception.filter.js';

/**
 * `statusFn` is a parameter so a test can assert the status code, not just the
 * body. It used to be created inside here and thrown away, which is why nothing
 * in this file checked a status — and why a ZodError answering 500 instead of
 * 400 went unnoticed until the first HTTP-level test.
 */
function mockHost(
  sendFn: ReturnType<typeof vi.fn>,
  statusFn: ReturnType<typeof vi.fn> = vi.fn().mockReturnValue({ send: sendFn }),
) {
  statusFn.mockReturnValue({ send: sendFn });
  return {
    switchToHttp: () => ({
      getResponse: () => ({
        status: statusFn,
      }),
      getRequest: () => ({ url: '/test', method: 'GET' }),
    }),
  } as never;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    sendFn = vi.fn();
  });

  it('maps PG 23P01 to 409 SLOT_UNAVAILABLE', () => {
    const err = Object.assign(new Error(), { code: '23P01' });
    filter.catch(err, mockHost(sendFn));

    const call = sendFn.mock.calls[0] as [{ error: { code: string; message: string } }];
    expect(call[0].error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('maps PG 23505 to 409 ALREADY_EXISTS', () => {
    const err = Object.assign(new Error(), { code: '23505' });
    filter.catch(err, mockHost(sendFn));

    const call = sendFn.mock.calls[0] as [{ error: { code: string } }];
    expect(call[0].error.code).toBe('ALREADY_EXISTS');
  });

  it('maps PG 23503 to 400 REFERENCE_MISSING', () => {
    const err = Object.assign(new Error(), { code: '23503' });
    filter.catch(err, mockHost(sendFn));

    const call = sendFn.mock.calls[0] as [{ error: { code: string } }];
    expect(call[0].error.code).toBe('REFERENCE_MISSING');
  });

  it('maps PG 40001 to 409 CONFLICT_RETRY', () => {
    const err = Object.assign(new Error(), { code: '40001' });
    filter.catch(err, mockHost(sendFn));

    const call = sendFn.mock.calls[0] as [{ error: { code: string } }];
    expect(call[0].error.code).toBe('CONFLICT_RETRY');
  });

  /**
   * A ZodError is not an HttpException, so before this mapping existed every
   * controller that validates with `schema.parse()` — all of them, R-CON-01 —
   * answered 500 for a malformed body. It read as our fault for what is plainly
   * the caller's, and it hid client bugs behind an on-call alert.
   */
  it('maps a ZodError to 400 VALIDATION_FAILED, not 500', () => {
    const schema = z.object({ vehicleType: z.enum(['car', 'two_wheeler']) });
    const result = schema.safeParse({ vehicleType: 'hovercraft' });
    if (result.success) throw new Error('fixture should not parse');

    const statusFn = vi.fn();
    filter.catch(result.error, mockHost(sendFn, statusFn));

    const call = sendFn.mock.calls[0] as [{ error: { code: string; message: string } }];
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(call[0].error.code).toBe('VALIDATION_FAILED');
    // Names the offending field, without dumping the whole schema at the client.
    expect(call[0].error.message).toContain('vehicleType');
  });

  it('carries traceId in every error response', () => {
    filter.catch(new NotFoundException('nope'), mockHost(sendFn));

    const call = sendFn.mock.calls[0] as [{ error: { traceId: string } }];
    expect(call[0].error.traceId).toBeDefined();
    expect(typeof call[0].error.traceId).toBe('string');
  });

  it('carries code and message in every error response', () => {
    filter.catch(new BadRequestException('bad input'), mockHost(sendFn));

    const call = sendFn.mock.calls[0] as [
      { error: { code: string; message: string; traceId: string } },
    ];
    expect(call[0].error.code).toBeDefined();
    expect(call[0].error.message).toBeDefined();
    expect(call[0].error.traceId).toBeDefined();
  });

  it('does not leak constraint names or SQL in the body for PG errors', () => {
    const err = Object.assign(new Error('duplicate key value violates unique_constraint_name'), {
      code: '23505',
      constraint: 'unique_users_phone',
      table: 'users',
      detail: 'Key (phone)=(+919876543210) already exists.',
    });
    filter.catch(err, mockHost(sendFn));

    const body = JSON.stringify(sendFn.mock.calls[0]);
    expect(body).not.toContain('unique_constraint_name');
    expect(body).not.toContain('unique_users_phone');
    expect(body).not.toContain('Key (phone)');
  });

  it('maps unknown errors to 500 INTERNAL_ERROR', () => {
    filter.catch(new Error('some internal thing'), mockHost(sendFn));

    const call = sendFn.mock.calls[0] as [{ error: { code: string } }];
    expect(call[0].error.code).toBe('INTERNAL_ERROR');
  });
});

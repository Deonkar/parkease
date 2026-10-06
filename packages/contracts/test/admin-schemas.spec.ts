import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  adminBookingsQuerySchema,
  adminPartnersQuerySchema,
  adminRefundSchema,
  adminSpaceQueueQuerySchema,
  adminUserSchema,
  adminUsersQuerySchema,
  auditQuerySchema,
  dateRangeSchema,
  grantRoleSchema,
  ledgerQuerySchema,
  moderationQueueItemSchema,
  spaceDecisionNotesSchema,
} from '../src/admin/index.js';
import { maskPhone, offsetPageOf } from '../src/primitives/index.js';

describe('adminRefundSchema', () => {
  it('accepts a preset option with a reason', () => {
    expect(adminRefundSchema.safeParse({ option: 'half', reason: 'x' }).success).toBe(true);
    expect(adminRefundSchema.safeParse({ option: 'full_minus_fee', reason: 'x' }).success).toBe(
      true,
    );
  });

  it('accepts a custom option with a positive integer amount', () => {
    expect(
      adminRefundSchema.safeParse({ option: 'custom', amountPaise: 500, reason: 'x' }).success,
    ).toBe(true);
  });

  it.each([
    ['no amount', { option: 'custom', reason: 'x' }],
    ['a zero amount', { option: 'custom', amountPaise: 0, reason: 'x' }],
    ['a fractional amount', { option: 'custom', amountPaise: 1.5, reason: 'x' }],
    ['a string amount', { option: 'custom', amountPaise: '100', reason: 'x' }],
    ['a blank reason', { option: 'half', reason: '   ' }],
    ['an unknown option', { option: 'double', reason: 'x' }],
  ])('rejects a custom refund with %s', (_label, input) => {
    expect(adminRefundSchema.safeParse(input).success).toBe(false);
  });
});

describe('spaceDecisionNotesSchema', () => {
  it('rejects whitespace-only notes', () => {
    expect(spaceDecisionNotesSchema.safeParse({ notes: '   ' }).success).toBe(false);
  });

  it('rejects notes over 1000 characters', () => {
    expect(spaceDecisionNotesSchema.safeParse({ notes: 'a'.repeat(1001) }).success).toBe(false);
  });

  it('trims accepted notes', () => {
    expect(spaceDecisionNotesSchema.parse({ notes: '  fix the photos ' }).notes).toBe(
      'fix the photos',
    );
  });
});

describe('dateRangeSchema', () => {
  it('accepts an ordinary range', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-10-01', to: '2026-10-08' }).success).toBe(true);
  });

  it('accepts exactly 366 days', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success).toBe(true);
  });

  it.each([
    ['from equal to to', { from: '2026-10-01', to: '2026-10-01' }],
    ['from after to', { from: '2026-10-02', to: '2026-10-01' }],
    ['a 400-day span', { from: '2026-01-01', to: '2027-02-05' }],
    ['an impossible date', { from: '2026-13-01', to: '2026-12-01' }],
    ['a datetime instead of a date', { from: '2026-10-01T00:00:00Z', to: '2026-10-08' }],
  ])('rejects %s', (_label, input) => {
    expect(dateRangeSchema.safeParse(input).success).toBe(false);
  });
});

describe('ledgerQuerySchema range', () => {
  it('accepts a missing, one-sided or ordinary range', () => {
    expect(ledgerQuerySchema.safeParse({}).success).toBe(true);
    expect(ledgerQuerySchema.safeParse({ from: '2026-10-01' }).success).toBe(true);
    expect(ledgerQuerySchema.safeParse({ to: '2026-10-01' }).success).toBe(true);
    expect(ledgerQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-08' }).success).toBe(
      true,
    );
  });

  it('accepts exactly 366 days', () => {
    expect(ledgerQuerySchema.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success).toBe(
      true,
    );
  });

  it.each([
    ['from equal to to', { from: '2026-10-01', to: '2026-10-01' }],
    ['from after to', { from: '2026-10-02', to: '2026-10-01' }],
    ['a 400-day span', { from: '2026-01-01', to: '2027-02-05' }],
  ])('rejects %s when both ends are set', (_label, input) => {
    expect(ledgerQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('auditQuerySchema range', () => {
  it('accepts a missing, one-sided or ordinary range', () => {
    expect(auditQuerySchema.safeParse({}).success).toBe(true);
    expect(auditQuerySchema.safeParse({ from: '2026-10-01' }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-08' }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success).toBe(true);
  });

  it.each([
    ['from equal to to', { from: '2026-10-01', to: '2026-10-01' }],
    ['from after to', { from: '2026-10-02', to: '2026-10-01' }],
    ['a 400-day span', { from: '2026-01-01', to: '2027-02-05' }],
  ])('rejects %s when both ends are set', (_label, input) => {
    expect(auditQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('grantRoleSchema', () => {
  it('rejects an unknown role', () => {
    expect(grantRoleSchema.safeParse({ role: 'superadmin', reason: 'x' }).success).toBe(false);
  });

  it('accepts a known role with a reason', () => {
    expect(grantRoleSchema.safeParse({ role: 'valet', reason: 'verified in person' }).success).toBe(
      true,
    );
  });
});

describe('admin list queries', () => {
  it('coerces page and pageSize from query strings and applies defaults', () => {
    expect(adminUsersQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(adminUsersQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it.each([{ page: '0' }, { pageSize: '0' }, { pageSize: '101' }, { page: '1.5' }])(
    'rejects %o',
    (input) => {
      expect(adminUsersQuerySchema.safeParse(input).success).toBe(false);
    },
  );

  it('defaults the space queue to pending_approval and the partner queue to pending', () => {
    expect(adminSpaceQueueQuerySchema.parse({}).status).toBe('pending_approval');
    expect(adminPartnersQuerySchema.parse({}).status).toBe('pending');
  });

  it('caps the ledger page at 200 and defaults it to 50', () => {
    expect(ledgerQuerySchema.parse({}).limit).toBe(50);
    expect(ledgerQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
  });

  it('takes IST calendar dates for booking filters', () => {
    expect(
      adminBookingsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-02' }).success,
    ).toBe(true);
    expect(adminBookingsQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });
});

describe('maskPhone and the admin views', () => {
  it('produces a value adminUserSchema accepts', () => {
    const user = adminUserSchema.safeParse({
      id: '0199b3a0-0000-7000-8000-000000000001',
      name: null,
      phone: maskPhone('+919876543210'),
      status: 'active',
      roles: [{ role: 'driver', status: 'active', grantedAt: '2026-10-01T00:00:00.000Z' }],
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    expect(user.success).toBe(true);
  });

  it('offsetPageOf carries items and page meta', () => {
    const schema = offsetPageOf(z.string());
    expect(
      schema.safeParse({ items: ['a'], meta: { page: 1, pageSize: 20, total: 1 } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ items: ['a'], meta: { page: 0, pageSize: 20, total: 1 } }).success,
    ).toBe(false);
  });
});

describe('moderationQueueItemSchema impact', () => {
  const item = {
    id: '0199b3a0-0000-7000-8000-000000000001',
    targetType: 'space',
    targetId: '0199b3a0-0000-7000-8000-000000000002',
    rating: 1,
    comment: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    reports: [],
  };

  it('rejects an item without impact', () => {
    expect(moderationQueueItemSchema.safeParse(item).success).toBe(false);
  });

  it('parses an item whose target would be left with no rating', () => {
    const impact = { currentAvgBp: 10_000, avgBpIfRemoved: null, countIfRemoved: 0 };
    expect(moderationQueueItemSchema.safeParse({ ...item, impact }).success).toBe(true);
  });

  it('parses an item with impact', () => {
    const impact = { currentAvgBp: 350, avgBpIfRemoved: 420, countIfRemoved: 4 };
    expect(moderationQueueItemSchema.safeParse({ ...item, impact }).success).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import {
  washerEarningsLineSchema,
  washerEarningsQuerySchema,
  washerEarningsSummarySchema,
  washerEarningsViewSchema,
} from '../src/washer/index.js';

const line = {
  jobId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  serviceName: 'premium_wash',
  vehicleType: 'car',
  completedAt: '2026-09-12T08:52:00.000Z',
  grossPaise: 39900,
  feePaise: 7980,
  netPaise: 31920,
};

describe('washerEarningsQuerySchema', () => {
  it('defaults to the week, because that is the period a partner is paid on', () => {
    expect(washerEarningsQuerySchema.parse({})).toEqual({ period: 'week' });
  });

  it('refuses a period it does not know', () => {
    expect(washerEarningsQuerySchema.safeParse({ period: 'fortnight' }).success).toBe(false);
  });
});

describe('washerEarningsLineSchema', () => {
  it('accepts a settled line', () => {
    expect(washerEarningsLineSchema.parse(line)).toEqual(line);
  });

  it('refuses a fractional amount — money is integer paise', () => {
    expect(washerEarningsLineSchema.safeParse({ ...line, netPaise: 319.2 }).success).toBe(false);
  });

  it('does NOT require net to be gross minus fee, because the ledger is the truth', () => {
    // A clawback, a correction or a promotion can all make these three
    // disagree with the obvious subtraction. The schema reports what the books
    // say; it does not re-derive it and it must not reject it.
    const odd = { ...line, grossPaise: 39900, feePaise: 7980, netPaise: 1 };
    expect(washerEarningsLineSchema.safeParse(odd).success).toBe(true);
  });
});

describe('washerEarningsViewSchema', () => {
  it('carries the period, the summary and the lines', () => {
    const view = washerEarningsViewSchema.parse({
      period: 'week',
      summary: { grossPaise: 39900, reversedPaise: 0, netPaise: 31920, jobsCompleted: 1 },
      lines: [line],
    });

    expect(view.period).toBe('week');
    expect(view.lines).toHaveLength(1);
  });

  it('accepts an empty ledger for a partner who has not finished a job yet', () => {
    const view = washerEarningsViewSchema.parse({
      period: 'today',
      summary: { grossPaise: 0, reversedPaise: 0, netPaise: 0, jobsCompleted: 0 },
      lines: [],
    });

    expect(view.lines).toEqual([]);
  });
});

describe('washerEarningsSummarySchema', () => {
  const summary = { grossPaise: 0, reversedPaise: 31920, netPaise: -31920, jobsCompleted: 0 };

  it('accepts a negative net, because a period can hold a reversal whose credit it does not', () => {
    // Accepted Sunday 23:55 IST, cancelled Monday 00:05: this week's movement
    // on owner_payable is one debit and no credit. That is what the books say
    // happened this week, and refusing it turned the default period into a 400.
    expect(washerEarningsSummarySchema.parse(summary).netPaise).toBe(-31920);
  });

  it('still refuses a negative gross — a sum of credits cannot be below zero', () => {
    expect(washerEarningsSummarySchema.safeParse({ ...summary, grossPaise: -1 }).success).toBe(
      false,
    );
  });

  it('still refuses a negative reversed total — a sum of debits cannot be below zero', () => {
    expect(washerEarningsSummarySchema.safeParse({ ...summary, reversedPaise: -1 }).success).toBe(
      false,
    );
  });

  it('refuses a fractional net — signed is still integer paise', () => {
    expect(washerEarningsSummarySchema.safeParse({ ...summary, netPaise: -319.2 }).success).toBe(
      false,
    );
  });
});

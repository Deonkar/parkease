import { payoutViewSchema, type PayoutView } from '@parkease/contracts/shared';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, render, text } from '../../__tests__/render-native';
import { PayoutRow } from '../PayoutRow';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

const payout = (patch: Partial<Record<string, unknown>>): PayoutView =>
  payoutViewSchema.parse({
    id: '01929b3a-0000-7000-8000-000000000003',
    period: '2026-W40',
    grossPaise: 280_000,
    tcsPaise: 0,
    tdsPaise: 0,
    netPaise: 280_000,
    status: 'paid',
    razorpayPayoutId: 'pout_QK7l1nFirst',
    createdAt: '2026-09-28T00:30:00.000Z',
    ...patch,
  });

describe('PayoutRow', () => {
  it('shows the net amount, the Monday it was sent, and its status in words', () => {
    const tree = render(<PayoutRow payout={payout({})} />);
    expect(text(byTestId(tree, 'payout-amount') ?? null)).toBe('₹2,800.00');
    expect(text(tree)).toContain('Mon 28 Sep');
    expect(text(tree)).toContain('To your bank');
    expect(text(byTestId(tree, 'payout-status') ?? null)).toBe('Paid');
  });

  it('never names an account: a payout keeps its fund account, not its last 4, and the bank may have changed since', () => {
    expect(text(render(<PayoutRow payout={payout({})} />))).not.toMatch(/····\d{4}/);
  });

  it.each([
    ['processing', 'Sent'],
    ['pending', 'Scheduled'],
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
    ['reversed', 'Returned'],
  ])('labels %s as %s', (status, label) => {
    const tree = render(<PayoutRow payout={payout({ status })} />);
    expect(text(byTestId(tree, 'payout-status') ?? null)).toBe(label);
  });

  it('says a failed payout went back into the balance, rather than just "Failed"', () => {
    const tree = render(<PayoutRow payout={payout({ status: 'failed' })} />);
    expect(text(tree)).toContain('added back to your balance');
  });

  it('shows each withholding as the server sent it, never summed on the phone', () => {
    const taxed = payout({
      grossPaise: 320_000,
      tcsPaise: 3_200,
      tdsPaise: 3_200,
      netPaise: 313_600,
    });
    const tree = render(<PayoutRow payout={taxed} />);
    expect(text(byTestId(tree, 'payout-tax') ?? null)).toBe('₹32.00 TCS · ₹32.00 TDS withheld');
  });
});

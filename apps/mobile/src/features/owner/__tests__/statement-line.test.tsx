import type { StatementLine as Line } from '@parkease/contracts/owner';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, render, text } from '../../shared/__tests__/render-native';
import { StatementLine } from '../components/StatementLine';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

const line = {
  bookingId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  occurredAt: '2026-09-12T04:49:00.000Z',
  driverName: 'Ravi K.',
  spaceName: 'Basement Parking',
  durationLabel: '2 hrs',
  basePaise: 6000,
  feePaise: 900,
  reversedPaise: 0,
  netPaise: 5100,
} as unknown as Line;

describe('StatementLine', () => {
  it('renders the response values unchanged', () => {
    const tree = render(<StatementLine line={line} />);
    expect(text(byTestId(tree, 'line-base') ?? null)).toBe('₹60.00');
    expect(text(byTestId(tree, 'line-fee') ?? null)).toBe('−₹9.00');
    expect(text(byTestId(tree, 'line-net') ?? null)).toBe('₹51.00');
    expect(text(byTestId(tree, 'line-who') ?? null)).toBe('Ravi K. · 2 hrs · Basement Parking');
  });

  it('shows the refund row only when something was refunded', () => {
    expect(byTestId(render(<StatementLine line={line} />), 'line-refund')).toBeUndefined();

    const refunded = { ...line, reversedPaise: 2550, netPaise: 2550 } as unknown as Line;
    const tree = render(<StatementLine line={refunded} />);
    expect(text(byTestId(tree, 'line-refund') ?? null)).toBe('−₹25.50');
    expect(text(byTestId(tree, 'line-net') ?? null)).toBe('₹25.50');
  });

  it('names no rate — the fee label carries no percentage (R-FE-06)', () => {
    const tree = render(<StatementLine line={line} />);
    expect(JSON.stringify(tree)).not.toMatch(/15\s*%|0\.15/);
  });
});

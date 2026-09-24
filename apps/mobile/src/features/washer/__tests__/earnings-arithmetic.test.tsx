import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { toPaise } from '@parkease/contracts/primitives';
import {
  WASHER_EARNINGS_PERIOD_VALUES,
  washerEarningsLineSchema,
  washerEarningsSummarySchema,
  type WasherEarningsLine,
  type WasherEarningsSummary,
} from '@parkease/contracts/washer';
import { colors, fontSize } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import { formatDateIST } from '@/lib/format';
import { formatPaise } from '@/lib/money';

import { byTestId, nodes, render, style, text } from '../../shared/__tests__/render-native';
import { EarningsLine } from '../components/EarningsLine';
import { EarningsSummary } from '../components/EarningsSummary';

// react-native ships Flow source the node-environment parser cannot read.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

/** Parsed, never cast: the fixture is held to the same contract as the wire. */
const line = (overrides: Partial<Record<keyof WasherEarningsLine, unknown>> = {}) =>
  washerEarningsLineSchema.parse({
    jobId: '0192f0a0-0000-7000-8000-000000000001',
    serviceName: 'premium_wash',
    vehicleType: 'car',
    // 08:52 UTC is 2:22 PM in Kolkata.
    completedAt: '2026-09-12T08:52:00.000Z',
    grossPaise: 39900,
    feePaise: 7980,
    netPaise: 31920,
    ...overrides,
  });

const summary = (overrides: Partial<Record<keyof WasherEarningsSummary, unknown>> = {}) =>
  washerEarningsSummarySchema.parse({
    grossPaise: 120000,
    reversedPaise: 0,
    netPaise: 120000,
    jobsCompleted: 5,
    ...overrides,
  });

const valueOf = (tree: ReturnType<typeof render>, testID: string) => {
  const node = byTestId(tree, testID);
  if (node === undefined) throw new Error(`no node with testID ${testID}`);
  return text(node);
};

/**
 * The conformance tests (spec §6.4, R-FE-06). Every fixture below is
 * deliberately incoherent: the net is NOT the gross minus the fee, and the
 * period net is NOT the gross minus the reversals. The guard is not "the
 * arithmetic is right here", it is "there is no arithmetic here" — if either
 * component derived a figure instead of rendering it, it would disagree with
 * the fixture and fail.
 */
describe('an earnings line renders the ledger, unchanged', () => {
  const incoherent = line({ grossPaise: 39900, feePaise: 7980, netPaise: 111 });

  it('renders all three amounts exactly as the server sent them', () => {
    const tree = render(<EarningsLine line={incoherent} />);

    expect(valueOf(tree, 'line-gross')).toBe('₹399.00');
    expect(valueOf(tree, 'line-fee')).toContain('₹79.80');
    expect(valueOf(tree, 'line-net')).toBe('₹1.11');
  });

  it('never shows what gross minus fee would have given', () => {
    const tree = render(<EarningsLine line={incoherent} />);

    expect(text(tree)).not.toContain('₹319.20');
    expect(text(tree)).not.toContain('319');
  });

  it('shows the fee as a deduction by its sign, never by a percentage', () => {
    const tree = render(<EarningsLine line={incoherent} />);

    // U+2212 MINUS SIGN in the text; the amount itself is the server's.
    expect(valueOf(tree, 'line-fee')).toBe('−₹79.80');
    expect(text(tree)).not.toMatch(/%/);
  });

  it('labels the three rows in words', () => {
    const tree = render(<EarningsLine line={incoherent} />);

    expect(text(tree)).toContain('Service price');
    expect(text(tree)).toContain('ParkEase fee');
    expect(text(tree)).toContain('You earned');
  });

  it('names the service and the vehicle from the shared labels', () => {
    const tree = render(<EarningsLine line={line({ vehicleType: 'two_wheeler' })} />);

    expect(text(tree)).toContain('Premium Wash');
    expect(text(tree)).toContain('bike');
  });

  it('dates the wash in Kolkata time, not the device zone', () => {
    const tree = render(<EarningsLine line={incoherent} />);

    // Through the shared formatter, whose month spelling is ICU's ("Sep" or
    // "Sept" for en-IN depending on the ICU build) — not this test's concern.
    const when = valueOf(tree, 'line-when');
    expect(when).toBe(`${formatDateIST(new Date('2026-09-12T08:52:00.000Z'))} · 2:22 PM`);
    expect(when).toMatch(/^12 Sep/);
  });
});

/** Ruling T9-I1: the one fixed caption, under the figure, on every summary. */
const CAPTION = 'Counted when you accept a wash. Completed washes are listed below.';

describe('the period summary renders the ledger, unchanged', () => {
  it('renders netPaise and reversedPaise unchanged, even when neither follows from the others', () => {
    // 1,20,000 − 31,920 would be ₹880.80; the server says ₹5.55. And gross −
    // net would be ₹1,194.45 reversed; the server says ₹319.20.
    const tree = render(
      <EarningsSummary
        period="week"
        summary={summary({ grossPaise: 120000, reversedPaise: 31920, netPaise: 555 })}
      />,
    );

    expect(valueOf(tree, 'earnings-net')).toBe('₹5.55');
    expect(valueOf(tree, 'earnings-reversed')).toContain(
      formatPaise(toPaise(31920), { alwaysDecimals: true }),
    );
    expect(text(tree)).not.toContain('880.80');
    expect(text(tree)).not.toContain('1,194.45');
    expect(text(tree)).not.toContain('₹1,200');
  });

  it('names the period in words and counts completed washes beside the figure', () => {
    const tree = render(<EarningsSummary period="week" summary={summary()} />);

    expect(text(tree)).toContain('This week');
    expect(valueOf(tree, 'earnings-jobs')).toBe('5 completed');
  });

  it('says "1 completed" for one wash', () => {
    const tree = render(<EarningsSummary period="today" summary={summary({ jobsCompleted: 1 })} />);

    expect(valueOf(tree, 'earnings-jobs')).toBe('1 completed');
    expect(text(tree)).toContain('Today');
  });

  it('reads to TalkBack as the figure and the count, never "earned"', () => {
    const tree = render(
      <EarningsSummary
        period="week"
        summary={summary({
          grossPaise: 0,
          reversedPaise: 31920,
          netPaise: -31920,
          jobsCompleted: 0,
        })}
      />,
    );

    const labels = nodes(tree).map((node): unknown => node.props['accessibilityLabel']);
    expect(labels).toContain('This week: −₹319.20. 0 completed.');
    expect(labels.join(' ')).not.toMatch(/earned/);
  });

  it.each(WASHER_EARNINGS_PERIOD_VALUES)(
    'says when money is counted, unconditionally, for %s (T9-I1)',
    (period) => {
      // The case the caption exists for: the first accepted wash of the
      // period, money in the hero and nothing completed under it.
      const tree = render(
        <EarningsSummary
          period={period}
          summary={summary({
            grossPaise: 31920,
            reversedPaise: 0,
            netPaise: 31920,
            jobsCompleted: 0,
          })}
        />,
      );

      const caption = byTestId(tree, 'earnings-caption');
      if (caption === undefined) throw new Error('no caption');
      expect(text(caption)).toBe(CAPTION);
      expect(style(caption)['color']).toBe(colors.textSecondary);
      expect(style(caption)['fontSize']).toBe(fontSize.sm);
    },
  );

  it('keeps the caption above the reversal line', () => {
    const tree = render(
      <EarningsSummary period="week" summary={summary({ reversedPaise: 31920, netPaise: 1 })} />,
    );

    const all = text(tree);
    expect(all.indexOf(CAPTION)).toBeGreaterThan(all.indexOf('₹0.01'));
    expect(all.indexOf(CAPTION)).toBeLessThan(all.indexOf('taken back'));
  });

  it('says nothing about cancellations when nothing was taken back', () => {
    const tree = render(<EarningsSummary period="week" summary={summary({ reversedPaise: 0 })} />);

    expect(byTestId(tree, 'earnings-reversed')).toBeUndefined();
    // The fixed caption is always there; only the conditional line is absent.
    expect(text(tree).replace(CAPTION, '')).not.toMatch(/taken back|cancel/i);
  });

  it("explains a clawback with the server amount, in a partner's words", () => {
    const tree = render(
      <EarningsSummary
        period="week"
        summary={summary({ grossPaise: 0, reversedPaise: 31920, netPaise: -31920 })}
      />,
    );

    expect(valueOf(tree, 'earnings-reversed')).toBe(
      'After ₹319.20 taken back for cancelled washes',
    );
    expect(valueOf(tree, 'earnings-reversed')).not.toMatch(/revers/i);
  });

  it('shows a negative period net with its sign, in ink, never in an error colour', () => {
    // A clawback is not an error: the line under it explains it.
    const tree = render(
      <EarningsSummary
        period="week"
        summary={summary({ grossPaise: 0, reversedPaise: 31920, netPaise: -31920 })}
      />,
    );

    const net = byTestId(tree, 'earnings-net');
    if (net === undefined) throw new Error('no hero figure');
    expect(text(net)).toBe('−₹319.20');
    expect(style(net)['color']).toBe(colors.text);
  });
});

/**
 * R-FE-06 at the source: a `-`, `+` or `*` against a paise value in either
 * component is the start of a client-side money figure, whatever it renders.
 */
describe('the earnings components hold no money arithmetic', () => {
  const code = (name: string) =>
    readFileSync(join(process.cwd(), 'src', 'features', 'washer', 'components', name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it.each(['EarningsLine.tsx', 'EarningsSummary.tsx'])('%s', (name) => {
    const source = code(name);

    expect(source).not.toMatch(/Paise\s*[-+*/]/);
    expect(source).not.toMatch(/[-+*/]\s*[\w.]*Paise\b/);
    // No rate and no percentage. The rate constants' names are held by the
    // R-FE-06 grep over this folder, which this file must itself pass.
    expect(source).not.toMatch(/0\.2|0\.8|%/);
  });
});

import { ApprovalStatus } from '@parkease/contracts/enums';
import { colors } from '@parkease/tokens';
import { describe, expect, it } from 'vitest';

import { APPROVAL_STATUS_DISPLAY } from '../approval-status';

/**
 * WCAG 2.1 relative luminance and contrast ratio — the same formula
 * `packages/tokens/test/contrast.spec.ts` uses, copied locally rather than
 * imported: that file lives under `packages/tokens/test/`, which is not part
 * of the published `@parkease/tokens` package output, so a cross-package
 * import of a test file is not available here.
 */
function luminance(hexColor: string): number {
  const hex = hexColor.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const value = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AA_NORMAL = 4.5;

/**
 * Round 2 (fix wave 5): every pair below is exactly what `SpaceRow` renders
 * a status's text (and icon, same colour) on. `active` never reads from the
 * map here — it renders the availability-green Live dot instead, text on the
 * row's plain `colors.surface` — and `inactive` renders its own hardcoded
 * "Paused · not in search" copy, not a map label, so both are asserted
 * directly rather than through `APPROVAL_STATUS_DISPLAY`. The other three
 * statuses render the map's own `color` on the dashboard's neutral pill,
 * `colors.mutedSoft` — the surface the first pass under-checked: `mutedSoft`
 * (#F1F5F9) is close to white but not white, and `colors.error` measured
 * 4.41:1 on it, under the 4.5:1 floor, even though `error` clears AA on pure
 * white/surface.
 */
describe('SpaceRow pill text clears AA on the surface it actually renders on', () => {
  it('active: availability green Live text on the row surface', () => {
    expect(contrast(colors.available, colors.surface)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('inactive: "Paused" text on the neutral pill', () => {
    expect(contrast(colors.textSecondary, colors.mutedSoft)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each([
    ApprovalStatus.PENDING_APPROVAL,
    ApprovalStatus.CHANGES_REQUESTED,
    ApprovalStatus.REJECTED,
  ])('%s: the shared map colour on the neutral pill (mutedSoft)', (status) => {
    const ratio = contrast(APPROVAL_STATUS_DISPLAY[status].color, colors.mutedSoft);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('rejected specifically uses errorInk, not error, on mutedSoft (the failure this round fixes)', () => {
    // Pinned so nobody "simplifies" this back to `colors.error`: it measures
    // 4.41:1 on `mutedSoft`, under AA, the same failure `colors.ts` already
    // documents for `error` on `errorLight`.
    expect(contrast(colors.error, colors.mutedSoft)).toBeLessThan(AA_NORMAL);
    expect(APPROVAL_STATUS_DISPLAY[ApprovalStatus.REJECTED].color).toBe(colors.errorInk);
  });
});

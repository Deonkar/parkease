import { describe, expect, it } from 'vitest';

import { colors } from '../src/colors.js';

/** WCAG 2.1 relative luminance. */
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

/** AA for normal text. Button labels are normal text — 14px semibold is not "large". */
const AA_NORMAL = 4.5;
/** AA for non-text UI: focus rings, marker fills, icon-only affordances. */
const AA_NON_TEXT = 3;

describe('contrast — text on its own surface', () => {
  it.each([
    ['text', colors.text, colors.surface],
    ['textSecondary', colors.textSecondary, colors.surface],
    ['textTertiary', colors.textTertiary, colors.surface],
    ['textTertiary on secondary surface', colors.textTertiary, colors.surfaceSecondary],
    ['textTertiary on tertiary surface', colors.textTertiary, colors.surfaceTertiary],
  ])('%s clears AA for normal text', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('contrast — white text on a coloured fill', () => {
  it.each([
    ['primary', colors.primary],
    ['primaryDark', colors.primaryDark],
    ['available', colors.available],
    ['error', colors.error],
    ['surge', colors.surge],
  ])('%s is safe behind white text', (_label, fill) => {
    expect(contrast(colors.textInverse, fill)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('contrast — coloured text on white', () => {
  it.each([
    ['primary', colors.primary],
    ['available', colors.available],
    ['surge', colors.surge],
    ['error', colors.error],
  ])('%s is readable as text on the base surface', (_label, fg) => {
    expect(contrast(fg, colors.surface)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('availableInk is readable on availableSoft', () => {
    expect(contrast(colors.availableInk, colors.availableSoft)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('surge is readable on surgeSoft', () => {
    expect(contrast(colors.surge, colors.surgeSoft)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('errorInk is readable on errorLight', () => {
    expect(contrast(colors.errorInk, colors.errorLight)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  /**
   * The reason `errorInk` exists at all, pinned so nobody "simplifies" the two
   * tiers back into one. `error` is tuned for white and lands at 4.41:1 on the
   * tinted panel — close enough to look fine and still a real AA failure, which
   * is exactly the kind that ships.
   */
  it('error is NOT readable on errorLight, which is why errorInk exists', () => {
    expect(contrast(colors.error, colors.errorLight)).toBeLessThan(AA_NORMAL);
  });
});

describe('contrast — non-text UI', () => {
  it('the focus ring is distinguishable from the surface', () => {
    expect(contrast(colors.borderFocused, colors.surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it.each([
    ['primaryVivid', colors.primaryVivid],
    ['availableVivid', colors.availableVivid],
    ['muted', colors.muted],
  ])('marker fill %s separates from the map surface', (_label, fill) => {
    expect(contrast(fill, colors.surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe('the vivid tones are documented as text-unsafe', () => {
  // These exist precisely because they do NOT clear AA behind small text. If a
  // future palette edit makes them safe, the two-tier split has become dead
  // weight and primary/primaryVivid should collapse back into one token.
  it.each([
    ['primaryVivid', colors.primaryVivid],
    ['availableVivid', colors.availableVivid],
  ])('%s still fails AA behind white text, so it stays marker-only', (_label, fill) => {
    expect(contrast(colors.textInverse, fill)).toBeLessThan(AA_NORMAL);
  });
});

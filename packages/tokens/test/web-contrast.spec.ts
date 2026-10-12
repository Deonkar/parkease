import { describe, expect, it } from 'vitest';

import { webColors as c } from '../src/web.js';

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

describe('web palette — text clears AA (4.5:1)', () => {
  it.each([
    ['ink on porcelain', c.ink, c.porcelain],
    ['slate on porcelain', c.slate, c.porcelain],
    ['slate on paper', c.slate, c.paper],
    ['slate on mist', c.slate, c.mist],
    ['onMidnight on midnight', c.onMidnight, c.midnight],
    ['onMidnightMuted on midnight', c.onMidnightMuted, c.midnight],
    ['onMidnightMuted on midnightRaised', c.onMidnightMuted, c.midnightRaised],
    ['skyOnMidnight on midnight', c.skyOnMidnight, c.midnight],
    ['midnight on porcelain button', c.midnight, c.porcelain],
    ['white on primary', c.onPrimary, c.primary],
    ['white on available marker', c.paper, c.available],
    ['white on full marker', c.paper, c.full],
    ['availableInk on availableSoft', c.availableInk, c.availableSoft],
    ['warnInk on warnSoft', c.warnInk, c.warnSoft],
    ['freeLit on floor (large stencil text)', c.freeLit, c.floor],
    ['map label on light land', c.mapLight.label, c.mapLight.land],
    ['map label on dark land', c.mapDark.label, c.mapDark.land],
  ])('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('web palette — non-text clears 3:1', () => {
  it.each([
    ['focus ring on porcelain', c.focus, c.porcelain],
    ['focus ring on midnight', c.focus, c.midnight],
    ['field border on paper', c.slate, c.paper],
  ])('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

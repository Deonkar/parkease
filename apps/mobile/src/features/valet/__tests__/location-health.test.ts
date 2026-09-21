import { describe, expect, it } from 'vitest';

import { FIX_FRESH_MS, FIX_STALE_MS, classifyFix, describeFixAge } from '../location/health';

/**
 * The boundary table from task 12 §12.5.
 *
 * A pin that stopped moving four minutes ago and a pin moving slowly render
 * identically unless the age of the fix is on screen, so these thresholds are
 * the difference between a valet app that can be trusted and one that cannot.
 */
describe('classifyFix', () => {
  const now = 1_700_000_000_000;

  it('is fresh at zero age', () => {
    expect(classifyFix(now, now, true)).toBe('fresh');
  });

  it('is fresh at exactly the fresh boundary', () => {
    expect(classifyFix(now - FIX_FRESH_MS, now, true)).toBe('fresh');
  });

  it('is stale one millisecond past the fresh boundary', () => {
    expect(classifyFix(now - FIX_FRESH_MS - 1, now, true)).toBe('stale');
  });

  it('is stale at exactly the stale boundary', () => {
    expect(classifyFix(now - FIX_STALE_MS, now, true)).toBe('stale');
  });

  it('is lost one millisecond past the stale boundary', () => {
    expect(classifyFix(now - FIX_STALE_MS - 1, now, true)).toBe('lost');
  });

  it('is lost when there has never been a fix', () => {
    expect(classifyFix(null, now, true)).toBe('lost');
  });

  it('reports revoked permission ahead of any age, including a fresh fix', () => {
    expect(classifyFix(now, now, false)).toBe('permission_revoked');
    expect(classifyFix(null, now, false)).toBe('permission_revoked');
  });
});

/**
 * The age string is derived from the fix timestamp, never from when the app
 * received it. A fix that sat in the offline queue for two minutes is two
 * minutes old, and saying otherwise is the lie §12.5 exists to prevent.
 */
describe('describeFixAge', () => {
  const now = 1_700_000_000_000;

  it('reads as seconds under a minute', () => {
    expect(describeFixAge(now - 2_000, now)).toBe('2s ago');
    expect(describeFixAge(now - 38_000, now)).toBe('38s ago');
  });

  it('reads as whole minutes at and beyond a minute', () => {
    expect(describeFixAge(now - 60_000, now)).toBe('1 min ago');
    expect(describeFixAge(now - 240_000, now)).toBe('4 min ago');
  });

  it('describes a queued fix by its own timestamp, not by now', () => {
    // Captured two minutes ago, drained from the queue this instant.
    expect(describeFixAge(now - 120_000, now)).toBe('2 min ago');
  });

  it('has no age to report when there has never been a fix', () => {
    expect(describeFixAge(null, now)).toBe(null);
  });
});

import type { PendingReview } from '@parkease/contracts/driver';
import { describe, expect, it } from 'vitest';

import {
  appendReason,
  isLowRating,
  LOW_RATING_REASONS,
  outstandingRows,
  rowsFromPending,
  type SheetRow,
} from '../reviews/sheet-state';

const pending = (reviewed: Partial<Record<string, boolean>> = {}): PendingReview => ({
  bookingId: '0192f1c0-0000-7000-8000-0000000000b0' as PendingReview['bookingId'],
  spaceTitle: 'Basement Parking',
  completedAt: '2026-10-04T10:00:00.000Z',
  reviewableUntil: '2026-10-11T10:00:00.000Z',
  targets: [
    {
      targetType: 'space',
      targetId: 's1',
      name: 'Basement Parking',
      reviewed: reviewed['s1'] ?? false,
    },
    { targetType: 'valet', targetId: 'v1', name: 'Ravi K.', reviewed: reviewed['v1'] ?? false },
    {
      targetType: 'washer',
      targetId: 'w1',
      name: 'Sparkle Wash',
      reviewed: reviewed['w1'] ?? false,
    },
  ],
});

describe('rowsFromPending', () => {
  it('offers every counterparty not yet reviewed, space first, unrated', () => {
    const rows = rowsFromPending(pending());
    expect(rows.map((r) => r.targetId)).toEqual(['s1', 'v1', 'w1']);
    expect(rows.every((r) => r.rating === null && r.comment === '')).toBe(true);
  });

  it('drops what the driver already reviewed', () => {
    expect(rowsFromPending(pending({ s1: true })).map((r) => r.targetId)).toEqual(['v1', 'w1']);
  });
});

describe('outstandingRows', () => {
  const rows: SheetRow[] = rowsFromPending(pending()).map((r, i) => ({ ...r, rating: i + 3 }));

  it('keeps only the rows that did not save, so the sheet reopens with just those', () => {
    const saved = new Set(['s1', 'w1']);
    expect(outstandingRows(rows, saved).map((r) => r.targetId)).toEqual(['v1']);
  });

  it('is empty once everything saved', () => {
    expect(outstandingRows(rows, new Set(['s1', 'v1', 'w1']))).toEqual([]);
  });
});

describe('low ratings', () => {
  it('asks what went wrong at 1 and 2 stars only', () => {
    expect([null, 1, 2, 3, 4, 5].map(isLowRating)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('adds a reason once, as a sentence, after whatever was typed', () => {
    const reason = LOW_RATING_REASONS[1];
    expect(appendReason('', reason)).toBe(`${reason}.`);
    expect(appendReason('Dark lane.', reason)).toBe(`Dark lane. ${reason}.`);
    expect(appendReason(`Dark lane. ${reason}.`, reason)).toBe(`Dark lane. ${reason}.`);
  });

  it('never pushes the comment past 500 characters', () => {
    const long = 'a'.repeat(495);
    expect(appendReason(long, LOW_RATING_REASONS[0])).toBe(long);
  });
});

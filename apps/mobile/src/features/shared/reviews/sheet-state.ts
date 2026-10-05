import type { PendingReview } from '@parkease/contracts/driver';

/** One counterparty in the rating sheet. Each saves on its own (task 17 §17.11). */
export interface SheetRow {
  readonly targetType: PendingReview['targets'][number]['targetType'];
  readonly targetId: string;
  readonly name: string;
  readonly rating: number | null;
  readonly comment: string;
}

/** The server's limit, counted the way it counts: code points. */
export const MAX_COMMENT = 500;

/** At or below this, the comment prompt becomes "What went wrong?" (direction C's idea, kept). */
export const LOW_RATING_MAX = 2;

/** Things an owner can fix. A bare one-star is not. */
export const LOW_RATING_REASONS = [
  'Hard to find',
  'Gate was closed',
  "Didn't match the photos",
] as const;

export function rowsFromPending(pending: PendingReview): SheetRow[] {
  return pending.targets
    .filter((target) => !target.reviewed)
    .map((target) => ({ ...target, rating: null, comment: '' }));
}

/** What is left after a submit: every row whose save did not land. */
export function outstandingRows(rows: readonly SheetRow[], saved: ReadonlySet<string>): SheetRow[] {
  return rows.filter((row) => !saved.has(row.targetId));
}

export const isLowRating = (rating: number | null): boolean =>
  rating !== null && rating <= LOW_RATING_MAX;

/**
 * A tapped reason becomes a sentence in the comment, once. It is text the driver can edit, not a
 * hidden tag: the owner reads the same words the driver sees.
 */
export function appendReason(comment: string, reason: string): string {
  const sentence = `${reason}.`;
  if (comment.includes(sentence)) return comment;
  const next = comment.trim() === '' ? sentence : `${comment.trimEnd()} ${sentence}`;
  return [...next].length > MAX_COMMENT ? comment : next;
}

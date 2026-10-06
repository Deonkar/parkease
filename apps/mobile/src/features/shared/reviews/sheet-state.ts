import type { PendingReview } from '@parkease/contracts/driver';

import { toApiFailure } from '../api/errors';

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

export interface SubmitResult {
  readonly saved: ReadonlySet<string>;
  readonly failed: number;
  /** The server's words for the first failure, to show instead of a generic "try again". */
  readonly message: string | null;
  /** What to log for each row that did not save (R-FAIL-01): never a bare count. */
  readonly failures: readonly {
    targetType: string;
    code: string;
    status: number | undefined;
    traceId: string | undefined;
  }[];
}

/**
 * Turns one submit's per-row outcomes into what the sheet shows. A retry of a review that did land
 * answers 409 REVIEW_ALREADY_EXISTS: that row is saved, not failed, or the sheet would ask the
 * driver to retry something that cannot succeed.
 */
export function settleSubmissions(
  rows: readonly Pick<SheetRow, 'targetId' | 'targetType'>[],
  results: readonly PromiseSettledResult<unknown>[],
): SubmitResult {
  const saved = new Set<string>();
  const failures: SubmitResult['failures'][number][] = [];
  let message: string | null = null;
  results.forEach((result, i) => {
    const row = rows[i];
    if (row === undefined) return;
    if (result.status === 'fulfilled') {
      saved.add(row.targetId);
      return;
    }
    const failure = toApiFailure(result.reason);
    if (failure.code === 'REVIEW_ALREADY_EXISTS') {
      saved.add(row.targetId);
      return;
    }
    failures.push({
      targetType: row.targetType,
      code: failure.code,
      status: failure.status,
      traceId: failure.traceId,
    });
    message ??= failure.message;
  });
  return { saved, failed: rows.length - saved.size, message, failures };
}

import { z } from 'zod';

export const REVIEW_REPORT_REASON_VALUES = [
  'spam_or_fake',
  'inappropriate',
  'irrelevant',
  'other',
] as const;

export const reviewReportReasonSchema = z.enum(REVIEW_REPORT_REASON_VALUES);
export type ReviewReportReason = z.infer<typeof reviewReportReasonSchema>;

export const ReviewReportReason = {
  SPAM_OR_FAKE: 'spam_or_fake',
  INAPPROPRIATE: 'inappropriate',
  IRRELEVANT: 'irrelevant',
  OTHER: 'other',
} as const satisfies Record<string, ReviewReportReason>;

type _MissingFromObject = Exclude<
  ReviewReportReason,
  (typeof ReviewReportReason)[keyof typeof ReviewReportReason]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

import { z } from 'zod';

export const APPROVAL_STATUS_VALUES = [
  'draft',
  'pending_review',
  'active',
  'changes_requested',
  'rejected',
  'paused',
] as const;

export const approvalStatusSchema = z.enum(APPROVAL_STATUS_VALUES);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const ApprovalStatus = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  ACTIVE: 'active',
  CHANGES_REQUESTED: 'changes_requested',
  REJECTED: 'rejected',
  PAUSED: 'paused',
} as const satisfies Record<string, ApprovalStatus>;

type _MissingFromObject = Exclude<
  ApprovalStatus,
  (typeof ApprovalStatus)[keyof typeof ApprovalStatus]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

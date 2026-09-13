import { z } from 'zod';

export const APPROVAL_STATUS_VALUES = [
  'pending_approval',
  'changes_requested',
  'rejected',
  'active',
  'inactive',
] as const;

export const approvalStatusSchema = z.enum(APPROVAL_STATUS_VALUES);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const ApprovalStatus = {
  PENDING_APPROVAL: 'pending_approval',
  CHANGES_REQUESTED: 'changes_requested',
  REJECTED: 'rejected',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const satisfies Record<string, ApprovalStatus>;

type _MissingFromObject = Exclude<
  ApprovalStatus,
  (typeof ApprovalStatus)[keyof typeof ApprovalStatus]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

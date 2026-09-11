import { z } from 'zod';

export const VERIFICATION_STATUS_VALUES = [
  'unverified',
  'pending',
  'verified',
  'rejected',
] as const;

export const verificationStatusSchema = z.enum(VERIFICATION_STATUS_VALUES);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const VerificationStatus = {
  UNVERIFIED: 'unverified',
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
} as const satisfies Record<string, VerificationStatus>;

type _MissingFromObject = Exclude<
  VerificationStatus,
  (typeof VerificationStatus)[keyof typeof VerificationStatus]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

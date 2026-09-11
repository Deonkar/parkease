import { z } from 'zod';

export const ROLE_STATUS_VALUES = ['active', 'pending', 'suspended', 'rejected'] as const;

export const roleStatusSchema = z.enum(ROLE_STATUS_VALUES);
export type RoleStatus = z.infer<typeof roleStatusSchema>;

export const RoleStatus = {
  ACTIVE: 'active',
  PENDING: 'pending',
  SUSPENDED: 'suspended',
  REJECTED: 'rejected',
} as const satisfies Record<string, RoleStatus>;

type _MissingFromObject = Exclude<RoleStatus, (typeof RoleStatus)[keyof typeof RoleStatus]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

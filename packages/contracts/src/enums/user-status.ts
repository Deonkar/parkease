import { z } from 'zod';

export const USER_STATUS_VALUES = ['active', 'blocked', 'deleted'] as const;

export const userStatusSchema = z.enum(USER_STATUS_VALUES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const UserStatus = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
  DELETED: 'deleted',
} as const satisfies Record<string, UserStatus>;

type _MissingFromObject = Exclude<UserStatus, (typeof UserStatus)[keyof typeof UserStatus]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

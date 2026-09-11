import { z } from 'zod';

export const ROLE_VALUES = ['driver', 'owner', 'valet', 'washer', 'admin'] as const;

export const roleSchema = z.enum(ROLE_VALUES);
export type Role = z.infer<typeof roleSchema>;

export const Role = {
  DRIVER: 'driver',
  OWNER: 'owner',
  VALET: 'valet',
  WASHER: 'washer',
  ADMIN: 'admin',
} as const satisfies Record<string, Role>;

type _MissingFromObject = Exclude<Role, (typeof Role)[keyof typeof Role]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

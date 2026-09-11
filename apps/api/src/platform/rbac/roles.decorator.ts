import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'parkease:roles';
export const Roles = (...roles: readonly string[]) => SetMetadata(ROLES_KEY, roles);

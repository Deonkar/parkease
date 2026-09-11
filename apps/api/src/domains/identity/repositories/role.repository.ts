import { Inject, Injectable } from '@nestjs/common';
import { userRoles } from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import type { TxHandle } from '../../../platform/db/transaction.js';

export interface ActiveRole {
  readonly id: string;
  readonly role: string;
  readonly status: string;
}

@Injectable()
export class RoleRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listActive(tx: TxHandle, userId: string): Promise<ActiveRole[]> {
    return tx
      .select({ id: userRoles.id, role: userRoles.role, status: userRoles.status })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.status, 'active')));
  }

  async hasActiveRole(tx: TxHandle, userId: string, role: string): Promise<boolean> {
    const rows = await tx
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(
        and(eq(userRoles.userId, userId), eq(userRoles.role, role), eq(userRoles.status, 'active')),
      );
    return rows.length > 0;
  }
}

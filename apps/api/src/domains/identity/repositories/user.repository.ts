import { Inject, Injectable } from '@nestjs/common';
import { users, userRoles } from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';

import type { VerifiedPhone } from '../../../platform/auth/firebase-verifier.service.js';
import { DB, type Database } from '../../../platform/db/db.module.js';
import type { TxHandle } from '../../../platform/db/transaction.js';

export interface UpsertResult {
  readonly id: string;
  readonly phone: string;
  readonly status: string;
  readonly isNew: boolean;
}

@Injectable()
export class UserRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async upsertByPhone(tx: TxHandle, verified: VerifiedPhone): Promise<UpsertResult> {
    const existing = await tx
      .select({ id: users.id, phone: users.phone, status: users.status })
      .from(users)
      .where(eq(users.phone, verified.phone));

    if (existing[0]) {
      await tx
        .update(users)
        .set({ lastActiveAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, existing[0].id));

      return { ...existing[0], isNew: false };
    }

    const inserted = await tx
      .insert(users)
      .values({
        phone: verified.phone,
        firebaseUid: verified.firebaseUid,
        status: 'active',
      })
      .returning({ id: users.id, phone: users.phone, status: users.status });

    const row = inserted[0];
    if (!row) throw new Error('INSERT … RETURNING yielded no row');
    return { ...row, isNew: true };
  }

  async findById(tx: TxHandle, userId: string) {
    const rows = await tx.select().from(users).where(eq(users.id, userId));
    return rows[0] ?? null;
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, userId));

    const profile = rows[0];
    if (!profile) return null;

    const roles = await this.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.status, 'active')));

    return {
      id: profile.id,
      phone: profile.phone,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      status: profile.status,
      roles: roles.map((r) => r.role),
      createdAt: profile.createdAt.toISOString(),
    };
  }
}

export interface UserProfile {
  readonly id: string;
  readonly phone: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly status: string;
  readonly roles: string[];
  readonly createdAt: string;
}

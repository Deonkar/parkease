import { Inject, Injectable } from '@nestjs/common';
import type { AdminUser, AdminUsersQuery } from '@parkease/contracts/admin';
import { roleSchema, roleStatusSchema, userStatusSchema } from '@parkease/contracts/enums';
import { maskPhone, userIdSchema } from '@parkease/contracts/primitives';
import { userRoles, users } from '@parkease/db/schema';
import { and, asc, desc, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';

/** `\`, `%` and `_` mean something to LIKE; an admin typing `100%` is looking for those characters. */
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

interface UserRow {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string;
  readonly status: string;
  readonly createdAt: Date;
}

const userColumns = {
  id: users.id,
  name: users.name,
  phone: users.phone,
  status: users.status,
  createdAt: users.createdAt,
};

/**
 * What the user-management screens read. The phone is masked here, before a row leaves the domain,
 * so no caller can forget to: an admin screen tells two people apart and never holds a number.
 */
@Injectable()
export class AdminUserQueries {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(q: AdminUsersQuery): Promise<{ items: AdminUser[]; total: number }> {
    const where = and(
      q.q === undefined || q.q === ''
        ? undefined
        : or(ilike(users.name, likePattern(q.q)), ilike(users.phone, likePattern(q.q))),
      q.status === undefined ? undefined : eq(users.status, q.status),
      // Any status: an admin hunting for a suspended owner to reinstate must be able to find one.
      q.role === undefined
        ? undefined
        : exists(
            this.db
              .select({ one: sql`1` })
              .from(userRoles)
              .where(and(eq(userRoles.userId, users.id), eq(userRoles.role, q.role))),
          ),
    );

    const [rows, [count]] = await Promise.all([
      this.db
        .select(userColumns)
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(users)
        .where(where),
    ]);

    return { items: await this.withRoles(rows), total: count?.total ?? 0 };
  }

  async detail(userId: string): Promise<AdminUser | undefined> {
    const rows = await this.db.select(userColumns).from(users).where(eq(users.id, userId));
    const [user] = await this.withRoles(rows);
    return user;
  }

  /** One query for the whole page's roles, not one per row. */
  private async withRoles(rows: readonly UserRow[]): Promise<AdminUser[]> {
    if (rows.length === 0) return [];

    const roleRows = await this.db
      .select({
        userId: userRoles.userId,
        role: userRoles.role,
        status: userRoles.status,
        grantedAt: userRoles.grantedAt,
      })
      .from(userRoles)
      .where(
        inArray(
          userRoles.userId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(userRoles.grantedAt), asc(userRoles.role));

    return rows.map((row) => ({
      id: userIdSchema.parse(row.id),
      name: row.name,
      phone: maskPhone(row.phone),
      status: userStatusSchema.parse(row.status),
      roles: roleRows
        .filter((r) => r.userId === row.id)
        .map((r) => ({
          role: roleSchema.parse(r.role),
          status: roleStatusSchema.parse(r.status),
          grantedAt: r.grantedAt.toISOString(),
        })),
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

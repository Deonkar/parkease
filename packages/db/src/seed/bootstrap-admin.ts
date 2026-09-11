import process from 'node:process';

import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { userRoles, users } from '../schema/identity.js';

import { parseSeedEnv } from './env.js';

async function main(): Promise<void> {
  const env = parseSeedEnv();
  const sql = postgres(env.DATABASE_URL);
  const db = drizzle(sql);

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ total: count() })
        .from(userRoles)
        .where(eq(userRoles.role, 'admin'));

      if ((existing?.total ?? 0) > 0) {
        // eslint-disable-next-line no-console -- seed script output
        console.info('bootstrap-admin: an admin already exists, nothing to do');
        return;
      }

      const [user] = await tx
        .insert(users)
        .values({
          phone: env.BOOTSTRAP_ADMIN_PHONE,
          name: env.BOOTSTRAP_ADMIN_NAME,
          firebaseUid: `bootstrap:${env.BOOTSTRAP_ADMIN_PHONE}`,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: users.phone,
          set: { updatedAt: new Date() },
        })
        .returning({ id: users.id });

      if (!user) throw new Error('bootstrap-admin: could not resolve the admin user');

      await tx
        .insert(userRoles)
        .values({ userId: user.id, role: 'admin', status: 'active', verifiedAt: new Date() })
        .onConflictDoNothing({ target: [userRoles.userId, userRoles.role] });

      // eslint-disable-next-line no-console -- seed script output
      console.info('bootstrap-admin: admin role granted');
    });
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- top-level error reporting
  console.error('bootstrap-admin failed:', err);
  process.exit(1);
});

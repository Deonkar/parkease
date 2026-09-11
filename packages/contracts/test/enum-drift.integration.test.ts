import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startPgContainer,
  runMigrations,
  stopPgContainer,
  type PgTestContext,
} from '../../testing/src/pg-container.js';
import {
  ROLE_VALUES,
  VEHICLE_TYPE_VALUES,
  BOOKING_STATUS_VALUES,
  DURATION_TYPE_VALUES,
  APPROVAL_STATUS_VALUES,
  VERIFICATION_STATUS_VALUES,
  VALET_JOB_STATUS_VALUES,
  CARWASH_JOB_STATUS_VALUES,
  PAYOUT_STATUS_VALUES,
  LEDGER_ACCOUNT_VALUES,
  NOTIFICATION_TYPE_VALUES,
  USER_STATUS_VALUES,
  ROLE_STATUS_VALUES,
  SLOT_STATUS_VALUES,
  PAYMENT_STATUS_VALUES,
  REFUND_STATUS_VALUES,
  LEDGER_DIRECTION_VALUES,
  OUTBOX_STATUS_VALUES,
} from '../src/enums/index.js';

let ctx: PgTestContext;

beforeAll(async () => {
  ctx = await startPgContainer();
  await runMigrations(ctx.sql);
});

afterAll(async () => {
  await stopPgContainer(ctx);
});

interface CheckConstraintRow {
  table_name: string;
  constraint_name: string;
  constraint_def: string;
}

async function getCheckValues(
  sql: postgres.Sql,
  tableName: string,
  constraintLike: string,
): Promise<Set<string>> {
  const rows = await sql<CheckConstraintRow[]>`
    SELECT
      c.relname AS table_name,
      con.conname AS constraint_name,
      pg_get_constraintdef(con.oid) AS constraint_def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ${tableName}
      AND con.contype = 'c'
      AND con.conname LIKE ${constraintLike}
  `;

  const allValues = new Set<string>();
  for (const row of rows) {
    const matches = row.constraint_def.matchAll(/'([^']+)'/g);
    for (const match of matches) {
      allValues.add(match[1]!);
    }
  }
  return allValues;
}

const enumMapping: Array<{
  name: string;
  tableName: string;
  constraintLike: string;
  values: readonly string[];
}> = [
  { name: 'role', tableName: 'user_roles', constraintLike: '%role_check%', values: ROLE_VALUES },
  {
    name: 'user_status',
    tableName: 'users',
    constraintLike: '%status_check%',
    values: USER_STATUS_VALUES,
  },
  {
    name: 'role_status',
    tableName: 'user_roles',
    constraintLike: '%status_check%',
    values: ROLE_STATUS_VALUES,
  },
  {
    name: 'vehicle_type',
    tableName: 'space_slots',
    constraintLike: '%vehicle_type_check%',
    values: VEHICLE_TYPE_VALUES,
  },
  {
    name: 'duration_type',
    tableName: 'bookings',
    constraintLike: '%duration_type_check%',
    values: DURATION_TYPE_VALUES,
  },
  {
    name: 'approval_status',
    tableName: 'spaces',
    constraintLike: '%approval_status_check%',
    values: APPROVAL_STATUS_VALUES,
  },
  {
    name: 'verification_status',
    tableName: 'valet_profiles',
    constraintLike: '%verification_status_check%',
    values: VERIFICATION_STATUS_VALUES,
  },
  {
    name: 'booking_status',
    tableName: 'bookings',
    constraintLike: '%status_check%',
    values: BOOKING_STATUS_VALUES,
  },
  {
    name: 'slot_status',
    tableName: 'booking_slots',
    constraintLike: '%status_check%',
    values: SLOT_STATUS_VALUES,
  },
  {
    name: 'payment_status',
    tableName: 'payments',
    constraintLike: '%status_check%',
    values: PAYMENT_STATUS_VALUES,
  },
  {
    name: 'refund_status',
    tableName: 'refunds',
    constraintLike: '%status_check%',
    values: REFUND_STATUS_VALUES,
  },
  {
    name: 'ledger_account',
    tableName: 'ledger_entries',
    constraintLike: '%account_check%',
    values: LEDGER_ACCOUNT_VALUES,
  },
  {
    name: 'ledger_direction',
    tableName: 'ledger_entries',
    constraintLike: '%direction_check%',
    values: LEDGER_DIRECTION_VALUES,
  },
  {
    name: 'payout_status',
    tableName: 'payouts',
    constraintLike: '%status_check%',
    values: PAYOUT_STATUS_VALUES,
  },
  {
    name: 'valet_job_status',
    tableName: 'valet_jobs',
    constraintLike: '%status_check%',
    values: VALET_JOB_STATUS_VALUES,
  },
  {
    name: 'carwash_job_status',
    tableName: 'wash_jobs',
    constraintLike: '%status_check%',
    values: CARWASH_JOB_STATUS_VALUES,
  },
  {
    name: 'notification_type',
    tableName: 'notifications',
    constraintLike: '%type_check%',
    values: NOTIFICATION_TYPE_VALUES,
  },
  {
    name: 'outbox_status',
    tableName: 'outbox_messages',
    constraintLike: '%status_check%',
    values: OUTBOX_STATUS_VALUES,
  },
];

describe('enum ↔ database CHECK constraint agreement', () => {
  it.each(enumMapping)(
    '$name: Zod enum matches $tableName.$constraintLike CHECK constraint values',
    async ({ tableName, constraintLike, values }) => {
      const dbValues = await getCheckValues(ctx.sql, tableName, constraintLike);

      expect(dbValues.size).toBeGreaterThan(0);

      const contractValues = new Set(values);
      expect(contractValues).toEqual(dbValues);
    },
  );
});

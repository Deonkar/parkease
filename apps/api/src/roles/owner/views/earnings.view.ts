import {
  type OwnerEarningsPeriod,
  type OwnerEarningsView,
  ownerEarningsViewSchema,
  type statementLineSchema,
} from '@parkease/contracts/owner';
import type { z } from 'zod';

import type { Movement, StatementRow } from '../../../domains/ledger/queries/owner-balance.js';
import { parseOutgoing } from '../../../platform/http/outgoing-contract.js';

/** "Ravi Kumar" → "Ravi K."; a driver with no name on file is "Driver". */
export function shortName(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const [first, ...rest] = parts;
  if (first === undefined) return 'Driver';
  const last = rest.at(-1);
  return last === undefined ? first : `${first} ${last.charAt(0).toUpperCase()}.`;
}

const PLAN_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' } as const;

function durationLabel(row: Pick<StatementRow, 'durationType' | 'startsAt' | 'endsAt'>): string {
  if (row.durationType !== 'hourly') return PLAN_LABELS[row.durationType];
  const hours = Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 3_600_000);
  return hours === 1 ? '1 hr' : `${String(hours)} hrs`;
}

/**
 * Unbranded: every caller runs the result through `parseOutgoing` (the
 * dashboard schema or the transactions page), which applies the brands and
 * refuses a bad row as a 500 — no `as` casts on the way.
 */
export function toStatementLine(row: StatementRow): z.input<typeof statementLineSchema> {
  return {
    bookingId: row.bookingId,
    occurredAt: row.occurredAt.toISOString(),
    driverName: shortName(row.driverName),
    spaceName: row.spaceName,
    durationLabel: durationLabel(row),
    basePaise: row.basePaise,
    feePaise: row.feePaise,
    reversedPaise: row.reversedPaise,
    netPaise: row.netPaise,
  };
}

export function toEarningsView(
  period: OwnerEarningsPeriod,
  movement: Movement,
  bookings: number,
  days: readonly { date: string; netPaise: number }[],
): OwnerEarningsView {
  return parseOutgoing(
    ownerEarningsViewSchema,
    {
      period,
      netPaise: movement.netPaise,
      grossPaise: movement.creditsPaise,
      reversedPaise: movement.debitsPaise,
      bookings,
      days,
    },
    'owner earnings view',
  );
}

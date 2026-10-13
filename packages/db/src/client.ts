import process from 'node:process';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

function getDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

/**
 * No statement on the shared pool runs longer than this (S-64). Every API path is budgeted in
 * milliseconds (search p95 200ms, booking 500ms); a statement still running at 30s is stuck, and
 * holding one of the pool's connections for it starves everything else. It is also the bound that
 * keeps a live attempt well inside `IDEMPOTENCY_IN_FLIGHT_STALE_MS`. A path that legitimately
 * runs longer (the ledger export's cursor) reserves a connection and raises it for itself.
 */
export const STATEMENT_TIMEOUT_MS = 30_000;

/** A transaction left open with nothing running (a crashed handler mid-transaction) is ended. */
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

const queryClient = postgres(getDatabaseUrl(), {
  connection: {
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  },
});

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

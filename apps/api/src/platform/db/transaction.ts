import { AsyncLocalStorage } from 'node:async_hooks';

import type { Database, Transaction } from '@parkease/db';
import { uuidv7 } from '@parkease/db';

import { fenceOnClaim } from '../idempotency/claim-context.js';

export interface TxContext {
  readonly txId: string;
}

export const txContext = new AsyncLocalStorage<TxContext>();

export type TxHandle = Transaction & { readonly __brand: unique symbol };

/**
 * A domain transaction. Under an idempotency claim it ends by fencing on that claim
 * (`fenceOnClaim`, S-64): a write from an attempt that has been taken over rolls back instead of
 * committing beside the retry that replaced it.
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: TxHandle) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) =>
    txContext.run({ txId: uuidv7() }, async () => {
      const result = await fn(tx as TxHandle);
      await fenceOnClaim(tx);
      return result;
    }),
  );
}

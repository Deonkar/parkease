import { AsyncLocalStorage } from 'node:async_hooks';

import type { Database, Transaction } from '@parkease/db';
import { uuidv7 } from '@parkease/db';

export interface TxContext {
  readonly txId: string;
}

export const txContext = new AsyncLocalStorage<TxContext>();

export type TxHandle = Transaction & { readonly __brand: unique symbol };

export async function withTransaction<T>(
  db: Database,
  fn: (tx: TxHandle) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => txContext.run({ txId: uuidv7() }, () => fn(tx as TxHandle)));
}

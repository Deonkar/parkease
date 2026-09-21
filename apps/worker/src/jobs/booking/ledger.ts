import { type LedgerEntryDraft, assertEntriesBalance } from '@parkease/contracts/money';
import type { Transaction } from '@parkease/db';
import { uuidv7 } from '@parkease/db/id';
import { ledgerEntries } from '@parkease/db/schema';

export interface WorkerLedgerPosting {
  readonly txnId?: string;
  readonly bookingId?: string;
  readonly counterpartyUserId?: string;
  readonly entries: readonly LedgerEntryDraft[];
}

/**
 * The worker's write path into the ledger. It mirrors the API's `LedgerService`
 * rather than importing it: `apps/worker` is a separate deployable with no Nest
 * container, and the part worth sharing — the entry composition and the balance
 * rule — already lives in `packages/contracts/money` where both can reach it.
 *
 * An empty posting is a no-op, not a failure. A job whose reversal nets to
 * nothing (a free booking) should release the slot and move on.
 */
export async function postLedger(
  tx: Transaction,
  posting: WorkerLedgerPosting,
): Promise<string | null> {
  if (posting.entries.length === 0) return null;

  assertEntriesBalance(posting.entries);
  const txnId = posting.txnId ?? uuidv7();

  await tx.insert(ledgerEntries).values(
    posting.entries.map((entry) => ({
      txnId,
      account: entry.account,
      direction: entry.direction,
      amountPaise: entry.amountPaise,
      description: entry.description,
      bookingId: posting.bookingId ?? null,
      /**
       * Entry-level wins over posting-level.
       *
       * A booking posting has one counterparty and stamps it on every row. A
       * valet leg does not: `owner_payable` belongs to the valet and the other
       * three belong to nobody, so a posting-level stamp would put the valet's
       * id on the driver's receivable and the earnings query — which filters
       * `owner_payable` by counterparty — would count the wrong rows (§11.6).
       */
      counterpartyUserId: entry.counterpartyUserId ?? posting.counterpartyUserId ?? null,
    })),
  );

  return txnId;
}

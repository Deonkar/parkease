import { Injectable } from '@nestjs/common';
import { type LedgerEntryDraft, assertEntriesBalance } from '@parkease/contracts/money';
import { uuidv7 } from '@parkease/db';
import { ledgerEntries } from '@parkease/db/schema';

import type { TxHandle } from '../../platform/db/transaction.js';

export interface LedgerPosting {
  /** Groups the entries that must balance. Generated here unless a caller pins it. */
  readonly txnId?: string;
  readonly bookingId?: string;
  readonly paymentId?: string;
  readonly payoutId?: string;
  readonly counterpartyUserId?: string;
  readonly entries: readonly LedgerEntryDraft[];
}

@Injectable()
export class LedgerService {
  /**
   * Writes one balanced posting. Takes a transaction handle rather than opening
   * its own: the ledger entries must commit with the business rows that justify
   * them, never separately (R-BE-03).
   *
   * The balance is asserted before the insert, so an unbalanced composition
   * aborts the whole transaction with the composition named — rather than
   * landing in the table for the nightly `ledger-balance` job to find.
   */
  async post(tx: TxHandle, posting: LedgerPosting): Promise<string> {
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
        paymentId: posting.paymentId ?? null,
        payoutId: posting.payoutId ?? null,
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
}

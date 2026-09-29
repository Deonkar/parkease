import { Inject, Injectable } from '@nestjs/common';
import { reverseEntries } from '@parkease/contracts/money';
import type { UpdateBankDetails } from '@parkease/contracts/shared';

import { encryptField } from '../../../platform/crypto/aes-gcm.js';
import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { AuditService } from '../../../platform/observability/audit.service.js';
import { logger } from '../../../platform/observability/logger.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { BankDetailsRejectedError, PayoutProviderUnavailableError } from '../errors.js';
import { type BankDetailsRow, PayoutService } from '../payout.service.js';
import { RAZORPAYX, type RazorpayXClient, RazorpayXError } from '../razorpayx.client.js';

export interface UpsertBankDetailsInput {
  readonly userId: string;
  readonly role: string | null;
  readonly details: UpdateBankDetails;
}

/**
 * Saves bank details and registers them with RazorpayX (§16.4, security.md §6.5).
 *
 * RazorpayX first, outside any transaction (rule 4): a Contact once per user,
 * a Fund Account per set of details. If RazorpayX refuses or is down, nothing
 * is written — the old details and their fund account stay exactly as they
 * were. Then one transaction: the encrypted row with the new fund account id,
 * every unsent payout cancelled and its posting reversed (the old account must
 * never receive money after a change), an audit row, and the notifications.
 *
 * The notification fires on every change, not only when payouts were
 * cancelled: a hostile change followed by a payout is theft, and the account
 * holder must hear about it even if they did not make it.
 */
@Injectable()
export class UpsertBankDetailsCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(RAZORPAYX) private readonly razorpayx: RazorpayXClient,
    private readonly payouts: PayoutService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async execute(input: UpsertBankDetailsInput): Promise<BankDetailsRow> {
    const { details, userId } = input;
    const existing = await this.payouts.bankFor(userId);
    const { contactId, fundAccountId } = await this.register(
      userId,
      existing?.razorpayxContactId ?? null,
      details,
    );
    const last4 = details.accountNumber.slice(-4);

    return withTransaction(this.db, async (tx) => {
      const row = await this.payouts.upsertBank(tx, {
        userId,
        accountNumberEncrypted: encryptField(details.accountNumber),
        ifscEncrypted: encryptField(details.ifscCode),
        accountHolderName: details.accountHolderName,
        last4,
        ifscPrefix: details.ifscCode.slice(0, 4),
        razorpayxContactId: contactId,
        razorpayxFundAccountId: fundAccountId,
      });

      const cancelled = await this.payouts.cancelPending(tx, userId);
      for (const payout of cancelled) {
        await this.ledger.post(tx, {
          payoutId: payout.id,
          entries: reverseEntries(payout.entries, 'payout cancelled: bank details changed'),
        });
      }

      await this.audit.record(tx, {
        actorUserId: userId,
        actorRole: input.role,
        action: 'bank_details.update',
        targetType: 'bank_details',
        targetId: row.id,
        // Never the old details, not even masked or encrypted.
        before: null,
        after: { last4, cancelledPayouts: cancelled.length },
        ipAddress: null,
      });

      await this.outbox.enqueue(
        tx,
        {
          type: 'notification.dispatch',
          payload: { userId, template: 'payout.bank_details_updated', data: { last4 } },
        },
        ...(cancelled.length === 0
          ? []
          : [
              {
                type: 'notification.dispatch',
                payload: {
                  userId,
                  template: 'payout.bank_changed',
                  data: { cancelledCount: cancelled.length },
                },
              },
            ]),
      );

      return row;
    });
  }

  private async register(
    userId: string,
    contactId: string | null,
    details: UpdateBankDetails,
  ): Promise<{ contactId: string; fundAccountId: string }> {
    try {
      const contact =
        contactId ??
        (await this.razorpayx.createContact({
          name: details.accountHolderName,
          referenceId: userId,
        }));
      const fundAccountId = await this.razorpayx.createFundAccount({
        contactId: contact,
        name: details.accountHolderName,
        ifsc: details.ifscCode,
        accountNumber: details.accountNumber,
      });
      return { contactId: contact, fundAccountId };
    } catch (error) {
      if (!(error instanceof RazorpayXError)) throw error;
      // The user id and status only: the request carried a bank account.
      logger.warn({ userId, status: error.status }, 'razorpayx refused bank details registration');
      throw error.rejected ? new BankDetailsRejectedError() : new PayoutProviderUnavailableError();
    }
  }
}

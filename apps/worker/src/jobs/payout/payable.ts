import { LedgerAccount } from '@parkease/contracts/enums';
import { bookings, ledgerEntries } from '@parkease/db/schema';
import { and, eq, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';

/**
 * The rows RazorpayX may pay out: a partner's side of `owner_payable`.
 *
 * - **Not owner-side.** Booking postings stamp the booking's DRIVER on the
 *   owner's credit (learnings), so a row whose counterparty is its booking's
 *   driver belongs to the space owner — never to the driver it names. Needs
 *   `bookings` LEFT JOINed on `booking_id`.
 * - **One rail per payee (ADR-030).** A user with an activated Route Linked
 *   Account is paid by Route at capture; paying them here too would pay twice.
 *   The outer column is spelled out, so the subquery correlates (learnings).
 */
export const partnerPayable = (userId?: string): SQL | undefined =>
  and(
    eq(ledgerEntries.account, LedgerAccount.OWNER_PAYABLE),
    isNotNull(ledgerEntries.counterpartyUserId),
    userId === undefined ? undefined : eq(ledgerEntries.counterpartyUserId, userId),
    or(isNull(bookings.id), ne(ledgerEntries.counterpartyUserId, bookings.driverId)),
    sql`not exists (select 1 from linked_accounts la
      where la.user_id = ${ledgerEntries}.${sql.identifier(ledgerEntries.counterpartyUserId.name)}
        and la.kyc_status = 'activated')`,
  );

/** Credits minus debits: `owner_payable` is a liability, so positive means we owe them. */
export const PAYABLE_BALANCE = sql<string>`(
  coalesce(sum(${ledgerEntries.amountPaise}) filter (where ${ledgerEntries.direction} = 'credit'), 0)
  - coalesce(sum(${ledgerEntries.amountPaise}) filter (where ${ledgerEntries.direction} = 'debit'), 0)
)::text`;

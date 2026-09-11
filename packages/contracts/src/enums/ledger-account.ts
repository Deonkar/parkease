import { z } from 'zod';

export const LEDGER_ACCOUNT_VALUES = [
  'driver_receivable',
  'owner_payable',
  'platform_revenue',
  'gst_payable',
  'tcs_payable',
  'tds_payable',
  'gateway_fees',
  'refunds_payable',
  'promo_expense',
] as const;

export const ledgerAccountSchema = z.enum(LEDGER_ACCOUNT_VALUES);
export type LedgerAccount = z.infer<typeof ledgerAccountSchema>;

export const LedgerAccount = {
  DRIVER_RECEIVABLE: 'driver_receivable',
  OWNER_PAYABLE: 'owner_payable',
  PLATFORM_REVENUE: 'platform_revenue',
  GST_PAYABLE: 'gst_payable',
  TCS_PAYABLE: 'tcs_payable',
  TDS_PAYABLE: 'tds_payable',
  GATEWAY_FEES: 'gateway_fees',
  REFUNDS_PAYABLE: 'refunds_payable',
  PROMO_EXPENSE: 'promo_expense',
} as const satisfies Record<string, LedgerAccount>;

type _MissingFromObject = Exclude<
  LedgerAccount,
  (typeof LedgerAccount)[keyof typeof LedgerAccount]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

import { z } from 'zod';

export const LEDGER_DIRECTION_VALUES = ['debit', 'credit'] as const;

export const ledgerDirectionSchema = z.enum(LEDGER_DIRECTION_VALUES);
export type LedgerDirection = z.infer<typeof ledgerDirectionSchema>;

export const LedgerDirection = {
  DEBIT: 'debit',
  CREDIT: 'credit',
} as const satisfies Record<string, LedgerDirection>;

type _MissingFromObject = Exclude<
  LedgerDirection,
  (typeof LedgerDirection)[keyof typeof LedgerDirection]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

import type { Paise, PaiseDelta } from '@parkease/contracts/primitives';

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(?:\d{2})+(?!\d))/g, ',')},${tail}`;
}

export interface FormatOptions {
  readonly alwaysDecimals?: boolean;
  readonly symbol?: boolean;
}

/** U+2212 MINUS SIGN: TalkBack reads it as "minus", where a hyphen is read as "dash". */
export const MINUS_SIGN = '−';

/**
 * Formats a server-issued amount for display. Signed amounts are accepted
 * because a period's ledger movement can be a clawback (`PaiseDelta`).
 *
 * The magnitude is formatted and the sign prefixed, once: `Math.trunc` and `%`
 * both carry the sign, so formatting a negative directly rendered -31920 as
 * "₹-,319.-20". This is display of a value, not price arithmetic (R-FE-06).
 */
export function formatPaise(amountPaise: Paise | PaiseDelta, options: FormatOptions = {}): string {
  const { alwaysDecimals = false, symbol = true } = options;

  const magnitude = Math.abs(amountPaise);
  const rupees = Math.trunc(magnitude / 100);
  const paise = magnitude % 100;

  const grouped = groupIndian(String(rupees));
  const body =
    paise === 0 && !alwaysDecimals ? grouped : `${grouped}.${String(paise).padStart(2, '0')}`;

  const sign = amountPaise < 0 ? MINUS_SIGN : '';
  return symbol ? `${sign}₹${body}` : `${sign}${body}`;
}

import type { Paise } from '@parkease/contracts/primitives';

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

export function formatPaise(amountPaise: Paise, options: FormatOptions = {}): string {
  const { alwaysDecimals = false, symbol = true } = options;

  const rupees = Math.trunc(amountPaise / 100);
  const paise = amountPaise % 100;

  const grouped = groupIndian(String(rupees));
  const body =
    paise === 0 && !alwaysDecimals ? grouped : `${grouped}.${String(paise).padStart(2, '0')}`;

  return symbol ? `₹${body}` : body;
}

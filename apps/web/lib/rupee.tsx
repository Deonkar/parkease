import type { ReactNode } from 'react';

/**
 * Rupee formatting for the whole site. No @parkease/contracts import, so client components can
 * use it without pulling the money module into their bundle.
 */
export function formatRupees(amount: number, decimals: 0 | 2 = 0): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Sets each ₹ in a display-type figure as a small raised sign in the body face. The display
 * face's ₹ lives in its latin-ext file, a 30KB download that would otherwise sit on the critical
 * path of every page with a price on it; Atkinson's ₹ is already needed for body copy.
 */
export function withRupee(text: string): ReactNode {
  const [first = '', ...rest] = text.split('₹');
  if (rest.length === 0) return text;
  return [
    first,
    ...rest.flatMap((part, i) => [
      <span key={i} className="rupee">
        ₹
      </span>,
      part,
    ]),
  ];
}

/** An amount in display type: formatted, with the raised body-face sign. */
export function Rupees({
  amount,
  decimals = 0,
}: {
  readonly amount: number;
  readonly decimals?: 0 | 2;
}) {
  return withRupee(formatRupees(amount, decimals));
}

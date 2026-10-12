import type { ReactNode } from 'react';

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

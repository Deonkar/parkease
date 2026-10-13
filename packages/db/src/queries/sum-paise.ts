/**
 * A ledger sum as read from Postgres, as a safe integer number of paise (S-86).
 *
 * `sum(bigint)` is `numeric`, which the driver hands over as a string (or the query casts to text)
 * so no precision is lost on the wire. `Number()` alone would then round anything past
 * `Number.MAX_SAFE_INTEGER` silently; this refuses instead, so a sum too large to hold exactly is a
 * loud 500 rather than a wrong balance. NULL (a sum over no rows) is 0.
 */
export function sumPaise(raw: string | number | bigint | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const exact =
    typeof raw === 'bigint' ? raw : BigInt(typeof raw === 'number' ? Math.trunc(raw) : raw.trim());
  if (exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`ledger sum ${exact.toString()} paise is outside the safe integer range`);
  }
  return Number(exact);
}

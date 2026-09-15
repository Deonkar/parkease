/**
 * Splits `totalPaise` across `weights` so the parts sum to exactly the total.
 *
 * Reversing a refund leg by leg — `mulRate(ownerEarnings, 0.5)`, then the same
 * for the fee and the GST — rounds three times independently, and three
 * independent roundings drift. A one-paisa drift is not a rounding detail here:
 * it is an unbalanced posting, which `assertEntriesBalance` refuses and which
 * therefore takes down the transaction the refund rides in (R-MONEY-04/06).
 *
 * Largest remainder, ties broken by index, so the same input always produces the
 * same output — a refund recomputed during an incident investigation has to
 * match the one that was written.
 *
 * The arithmetic is BigInt throughout rather than `total * weight / sum` in
 * floating point: at ₹1 crore across several legs the product exceeds 2^53 and
 * the "exact" share stops being exact, which is the one input where getting this
 * wrong would matter most.
 *
 * Plain integers rather than the branded `Paise`, deliberately. The weights are
 * a booking row's money columns, which arrive as `number` from Drizzle; taking
 * `Paise` would mean four `as Paise` assertions at the only call site, and an
 * assertion on a value from outside the process is exactly what R-VAL-01
 * forbids. So the shape is checked here instead of asserted there.
 */
export function allocateProportionally(
  totalPaise: number,
  weights: readonly number[],
): readonly number[] {
  if (weights.length === 0) {
    throw new RangeError('Cannot allocate across zero legs');
  }
  if (!Number.isInteger(totalPaise) || totalPaise < 0) {
    throw new RangeError(`Cannot allocate ${String(totalPaise)}: not a non-negative integer`);
  }
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 0)) {
    throw new RangeError('Allocation weights must all be non-negative integers');
  }

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  // Every leg is worthless, so no leg has a claim. Returning zeros keeps the
  // posting balanced — zero changes no sum — and lets the caller drop it.
  if (weightSum === 0) return weights.map(() => 0);

  const divisor = BigInt(weightSum);
  const shares = weights.map((weight) => {
    const numerator = BigInt(totalPaise) * BigInt(weight);
    return { floor: numerator / divisor, remainder: numerator % divisor };
  });

  const parts = shares.map((share) => Number(share.floor));
  let spare = totalPaise - parts.reduce((sum, part) => sum + part, 0);

  const byRemainder = shares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((a, b) => {
      if (a.remainder === b.remainder) return a.index - b.index;
      return a.remainder > b.remainder ? -1 : 1;
    });

  for (const { index } of byRemainder) {
    if (spare === 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    spare -= 1;
  }

  return parts;
}

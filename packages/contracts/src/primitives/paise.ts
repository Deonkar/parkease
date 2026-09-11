import { z } from 'zod';

export const paiseSchema = z.number().int().nonnegative().brand<'Paise'>();
export type Paise = z.infer<typeof paiseSchema>;

export const paiseDeltaSchema = z.number().int().brand<'PaiseDelta'>();
export type PaiseDelta = z.infer<typeof paiseDeltaSchema>;

export const toPaise = (value: number): Paise => paiseSchema.parse(value);

export const rateSchema = z.number().min(0).max(10).brand<'Rate'>();
export type Rate = z.infer<typeof rateSchema>;

export const toRate = (value: number): Rate => rateSchema.parse(value);

const RATE_SCALE = 10_000n;

export function mulRate(amountPaise: Paise, rate: Rate): Paise {
  const scaledRate = BigInt(Math.round(rate * Number(RATE_SCALE)));
  const numerator = BigInt(amountPaise) * scaledRate;
  const quotient = numerator / RATE_SCALE;
  const remainder = numerator % RATE_SCALE;
  const rounded = remainder * 2n >= RATE_SCALE ? quotient + 1n : quotient;
  return Number(rounded) as Paise;
}

export const addPaise = (...amounts: readonly Paise[]): Paise =>
  amounts.reduce<number>((sum, amount) => sum + amount, 0) as Paise;

export function subPaise(minuend: Paise, subtrahend: Paise): Paise {
  const result = minuend - subtrahend;
  if (result < 0) {
    throw new RangeError(
      `Paise subtraction underflowed: ${String(minuend)} - ${String(subtrahend)}`,
    );
  }
  return result as Paise;
}

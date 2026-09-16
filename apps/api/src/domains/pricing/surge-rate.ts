import { BASIS_POINTS } from '@parkease/contracts/admin';
import { toRate, type Rate } from '@parkease/contracts/primitives';

/**
 * Basis points to the `Rate` the money helpers take.
 *
 * It lives in `domains/pricing` because `pricing` is the only module allowed to
 * produce a money amount (R-ARCH-06), and this is the one conversion standing
 * between the integer the ladder is expressed in and every paise figure derived
 * from it. Three call sites — the extension quote and the two driver views —
 * is the second use that earns the extraction (R-ARCH-07).
 */
export const surgeRateOf = (multiplierBp: number): Rate => toRate(multiplierBp / BASIS_POINTS);

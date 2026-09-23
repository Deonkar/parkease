import { CARWASH_SERVICE_NAME_VALUES, type CarwashServiceName } from '@parkease/contracts/enums';
import type { WashService } from '@parkease/contracts/washer';

/**
 * The partner sees one row per service; the database holds two.
 *
 * §13.3: v1 stored one price beside a vehicle type that could be `BOTH`, which
 * no price lookup could resolve and no partner could use to charge a car and a
 * bike differently. The fold lives here, in a pure module, because getting it
 * wrong is an off-by-100 on somebody's income and that deserves a unit test
 * rather than a component test.
 *
 * Pure and free of `react-native`, so the node test environment can reach it.
 */

/** Mirrors `servicePriceSchema` in the contract. Kept here so the input can be refused early. */
export const MIN_PRICE_PAISE = 1_000;
export const MAX_PRICE_PAISE = 999_900;

export interface MenuRow {
  readonly serviceName: CarwashServiceName;
  /** Null when this partner has never priced this combination. */
  readonly carPricePaise: number | null;
  readonly bikePricePaise: number | null;
  readonly durationMinutes: number;
  readonly isActive: boolean;
}

const DEFAULT_DURATION_MINUTES = 30;

export function toMenuRows(services: readonly WashService[]): MenuRow[] {
  return CARWASH_SERVICE_NAME_VALUES.map((serviceName) => {
    const car = services.find((s) => s.serviceName === serviceName && s.vehicleType === 'car');
    const bike = services.find(
      (s) => s.serviceName === serviceName && s.vehicleType === 'two_wheeler',
    );
    const either = car ?? bike;

    return {
      serviceName,
      carPricePaise: car?.pricePaise ?? null,
      bikePricePaise: bike?.pricePaise ?? null,
      durationMinutes: either?.durationMinutes ?? DEFAULT_DURATION_MINUTES,
      // Absent means never configured, which is not the same as switched off:
      // a new partner's rows are editable and inactive until they save one.
      isActive: either?.isActive ?? false,
    };
  });
}

/** `123` or `123.45`, nothing else — no exponents, no sign, at most two decimals. */
const RUPEES = /^\d{1,5}(?:\.\d{1,2})?$/;

/**
 * Rupees as typed → paise, or null when it is not a price this contract accepts.
 *
 * Parsed digit-wise rather than `Number(x) * 100`, because 10.03 * 100 is
 * 1002.9999999999999 in floating point and a systematic one-paise error across
 * every price is a ledger that never balances.
 */
export function rupeesToPaise(input: string): number | null {
  const trimmed = input.trim();
  if (!RUPEES.test(trimmed)) return null;

  const [rupees = '0', decimals = ''] = trimmed.split('.');
  const paise = Number(rupees) * 100 + Number(decimals.padEnd(2, '0'));

  if (paise < MIN_PRICE_PAISE || paise > MAX_PRICE_PAISE) return null;
  return paise;
}

/** Paise → what goes in the text input. Whole rupees carry no decimals. */
export function paiseToRupees(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const remainder = paise % 100;
  return remainder === 0
    ? String(rupees)
    : `${String(rupees)}.${String(remainder).padStart(2, '0')}`;
}

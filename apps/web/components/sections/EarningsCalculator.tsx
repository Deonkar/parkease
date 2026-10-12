'use client';

import { useId, useState } from 'react';

import { estimateMonthlyEarnings } from '@/lib/earnings';

type Vehicle = 'car' | 'two_wheeler';

const RANGE = {
  car: { min: 10, max: 200, start: 30 },
  two_wheeler: { min: 5, max: 60, start: 15 },
} as const;

const inr = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

/**
 * `hourlyPrice × hoursPerDay × 30 × (1 − commission)` (task 20 §20.7). Defaults to ₹30 × 6 hours,
 * which reads ₹4,590. The launch waiver is opt-in so the default matches what most owners pay.
 */
export function EarningsCalculator({
  commissionRate,
  waiverSlots,
  waiverMonths,
  minimumPayout,
}: {
  readonly commissionRate: number;
  readonly waiverSlots: number;
  readonly waiverMonths: number;
  readonly minimumPayout: number;
}) {
  const id = useId();
  const [vehicle, setVehicle] = useState<Vehicle>('car');
  const [hourlyPrice, setHourlyPrice] = useState<number>(RANGE.car.start);
  const [hoursPerDay, setHoursPerDay] = useState(6);
  const [slots, setSlots] = useState(1);
  const [waived, setWaived] = useState(false);

  const rate = waived ? 0 : commissionRate;
  const monthly = estimateMonthlyEarnings({
    hourlyPrice,
    hoursPerDay,
    slots,
    commissionRate: rate,
  });
  const gross = estimateMonthlyEarnings({ hourlyPrice, hoursPerDay, slots, commissionRate: 0 });
  const percent = Math.round(commissionRate * 100);

  const pick = (next: Vehicle) => {
    setVehicle(next);
    setHourlyPrice(RANGE[next].start);
  };

  const slider = (
    key: string,
    label: string,
    value: number,
    shown: string,
    min: number,
    max: number,
    step: number,
    onChange: (n: number) => void,
  ) => (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={`${id}-${key}`} className="font-bold">
          {label}
        </label>
        <output htmlFor={`${id}-${key}`} className="type-figure text-4xl">
          {shown}
        </output>
      </div>
      <input
        id={`${id}-${key}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        className="mt-2 h-11 w-full cursor-pointer accent-ink"
      />
    </div>
  );

  return (
    <div className="flex flex-wrap items-start gap-x-22 gap-y-12">
      <form
        className="flex min-w-0 flex-[1_1_420px] flex-col gap-7"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <fieldset>
          <legend className="mb-3 font-bold">What parks there?</legend>
          <div className="relative flex rounded-[14px] bg-mist p-[5px]">
            <span
              aria-hidden="true"
              className="tab-indicator absolute inset-y-[5px] left-[5px] w-[calc(50%-5px)] rounded-[10px] bg-ink"
              style={{ transform: `translateX(${vehicle === 'car' ? '0%' : '100%'})` }}
            />
            {(['car', 'two_wheeler'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vehicle === v}
                onClick={() => {
                  pick(v);
                }}
                className={`relative h-[46px] flex-1 cursor-pointer font-bold transition-colors ${vehicle === v ? 'text-paper' : 'text-slate'}`}
              >
                {v === 'car' ? 'Car' : 'Two-wheeler'}
              </button>
            ))}
          </div>
        </fieldset>
        {slider(
          'price',
          'Hourly price (₹)',
          hourlyPrice,
          `₹${String(hourlyPrice)}/hr`,
          RANGE[vehicle].min,
          RANGE[vehicle].max,
          5,
          setHourlyPrice,
        )}
        {slider(
          'hours',
          'Hours rented per day',
          hoursPerDay,
          `${String(hoursPerDay)} hrs/day`,
          1,
          24,
          1,
          setHoursPerDay,
        )}
        {slider('slots', 'Slots', slots, String(slots), 1, 20, 1, setSlots)}
      </form>

      <div className="flex max-w-[540px] min-w-0 flex-[1_1_420px] flex-col gap-4 rounded-3xl bg-midnight p-8 text-on-midnight shadow-[0_40px_80px_-40px_var(--pe-shadow)]">
        <span className="font-bold text-on-midnight-muted">Estimated monthly earnings</span>
        <span aria-live="polite" className="type-figure text-[clamp(64px,8vw,104px)]">
          {inr(monthly)}
        </span>
        <span className="text-on-midnight-muted">
          {waived
            ? `No commission during your first ${String(waiverMonths)} months.`
            : `After ${String(percent)}% ParkEase commission.`}
        </span>
        <div className="mt-2 flex flex-col gap-2.5">
          <div
            role="img"
            aria-label={
              waived
                ? 'You keep all of the booking price'
                : `You keep ${String(100 - percent)}%, ParkEase keeps ${String(percent)}%`
            }
            className="relative h-3 overflow-hidden rounded-full bg-porcelain"
          >
            <span
              className="share-bar absolute inset-y-0 right-0 bg-midnight-raised shadow-[inset_0_0_0_1px_var(--pe-midnight-rule)]"
              style={{ width: `${String(percent)}%`, transform: `scaleX(${waived ? '0' : '1'})` }}
            />
          </div>
          <div className="flex justify-between gap-3 text-[15px]">
            <span className="font-bold">
              You keep {waived ? 'all of it' : `${String(100 - percent)}%`}
            </span>
            <span className="text-on-midnight-muted">
              {waived ? 'Commission waived' : `ParkEase keeps ${inr(gross - monthly)}`}
            </span>
          </div>
        </div>
        <label className="mt-1.5 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-midnight-raised px-3.5 font-bold shadow-[inset_0_0_0_1px_var(--pe-midnight-rule)]">
          <input
            type="checkbox"
            checked={waived}
            onChange={(e) => {
              setWaived(e.target.checked);
            }}
            className="size-[22px] accent-sky"
          />
          I’m one of the first {waiverSlots} owners
        </label>
        <p className="border-t border-midnight-rule pt-3 text-sm leading-relaxed text-on-midnight-muted">
          Price × hours × 30 days. Excludes busy-hour charges, which drivers pay on top. Paid weekly
          on Mondays once you’ve earned ₹{minimumPayout}.
        </p>
      </div>
    </div>
  );
}

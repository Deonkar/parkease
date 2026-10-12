import { PRICING } from '@/lib/pricing';
import { formatRupees, withRupee } from '@/lib/rupee';

export function RefundRules() {
  const r = PRICING.refunds;
  const rows = [
    {
      figure: `All but ${formatRupees(r.processingFee)}`,
      text: 'back if you cancel before your start time.',
    },
    {
      figure: `${String(r.gracePercent)}% back`,
      text: `if you cancel within ${String(r.graceMinutes)} minutes of the start.`,
    },
    { figure: 'Nothing', text: 'back after that. The slot was held for you.' },
    {
      figure: `All + ${formatRupees(r.ownerCancelGoodwill)}`,
      text: `back if the owner cancels, at any hour. The ${formatRupees(r.ownerCancelGoodwill)} comes from ParkEase.`,
      highlight: true,
    },
  ];
  return (
    <dl className="border-y-2 border-ink">
      {rows.map((row, i) => (
        <div
          key={row.figure}
          className={`flex flex-wrap items-baseline gap-x-7 gap-y-1 py-6 ${i > 0 ? 'border-t border-rule' : ''}`}
        >
          <dt
            className={`type-figure flex-[0_0_250px] text-[44px] leading-none ${row.highlight ? 'text-primary' : ''}`}
          >
            {withRupee(row.figure)}
          </dt>
          <dd className="flex-[1_1_220px] text-[17px] leading-normal">{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}

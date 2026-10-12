import { formatRupees, PRICING } from '@/lib/pricing';

interface Row {
  readonly label: string;
  readonly value: string;
}

function Ledger({
  title,
  rows,
  note,
}: {
  readonly title: string;
  readonly rows: readonly Row[];
  readonly note?: string;
}) {
  return (
    <div>
      <h3 className="type-card border-b-2 border-ink pb-3.5 text-4xl">{title}</h3>
      <table className="w-full text-[17px]">
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.label} className={i > 0 ? 'border-t border-rule' : ''}>
              <th scope="row" className="py-4 pr-4 text-left align-top font-bold">
                {row.label}
              </th>
              <td className="py-4 text-right text-slate">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note !== undefined && <p className="mt-3.5 text-[15px] text-slate">{note}</p>}
    </div>
  );
}

/** Matches ADR-009: one platform fee, and no driver-side platform fee line. */
export function PricingTable() {
  const p = PRICING;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] gap-x-18 gap-y-14">
      <Ledger
        title="For drivers"
        rows={[
          { label: 'Base price', value: 'Set by the space owner' },
          {
            label: 'Surge pricing',
            value: `Up to ${String(p.surgeMaxMultiplier)}× based on demand, shown before you book`,
          },
          { label: 'GST', value: `${String(p.gstPercent)}% on the ParkEase fee` },
        ]}
        note="You always see the full breakdown before you pay."
      />
      <Ledger
        title="For space owners"
        rows={[
          { label: 'Listing fee', value: 'Free' },
          {
            label: 'Commission',
            value: `${String(p.commissionPercent)}% of the base booking price, charged once`,
          },
          {
            label: 'Launch offer',
            value: `0% for ${String(p.waiverMonths)} months, first ${String(p.waiverSlots)} owners`,
          },
          { label: 'Payouts', value: p.payouts.label },
          { label: 'Minimum payout', value: formatRupees(p.minimumPayout) },
        ]}
      />
      <Ledger
        title="For valet partners"
        rows={[
          { label: 'Registration', value: 'Free' },
          { label: 'Commission', value: `${String(p.valet.commissionPercent)}% of valet fee` },
          {
            label: 'Earnings example',
            value: `${formatRupees(p.valet.exampleFee)} job → you earn ${formatRupees(p.valet.exampleEarns)}`,
          },
        ]}
      />
      <Ledger
        title="For car wash partners"
        rows={[
          { label: 'Registration', value: 'Free' },
          { label: 'Commission', value: `${String(p.wash.commissionPercent)}% of service price` },
          {
            label: 'Earnings example',
            value: `${formatRupees(p.wash.examplePrice)} Premium Wash → you earn ${formatRupees(p.wash.exampleEarns)}`,
          },
        ]}
      />
    </div>
  );
}

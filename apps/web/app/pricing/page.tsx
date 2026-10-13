import type { Metadata } from 'next';
import Link from 'next/link';

import { CtaBand } from '@/components/sections/CtaBand';
import { PageHero } from '@/components/sections/PageHero';
import { PricingTable } from '@/components/sections/PricingTable';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { PAGES } from '@/lib/pages';
import { PRICING } from '@/lib/pricing';
import { formatRupees, Rupees } from '@/lib/rupee';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.pricing);

export default function PricingPage() {
  const e = PRICING.example;
  const segments = [
    {
      label: 'Owner',
      amount: e.owner,
      className: 'bg-primary text-on-primary',
      size: 'text-[40px]',
    },
    {
      label: 'ParkEase',
      amount: e.parkease,
      className: 'bg-sky text-midnight',
      size: 'text-[26px]',
    },
    { label: 'GST', amount: e.gst, className: 'bg-field text-midnight', size: 'text-[22px]' },
  ];
  return (
    <>
      <PageHero
        lines={['Transparent pricing.', 'No hidden fees.']}
        lead="One fee, shown before anyone pays. Drivers never pay a platform fee, and nobody pays to sign up."
      />
      <section aria-labelledby="example-title">
        <div className="wrap flex flex-wrap items-center gap-x-22 gap-y-12 py-28">
          <div className="flex flex-[1_1_380px] flex-col gap-4">
            <SectionHeading id="example-title">
              Where {formatRupees(e.driverTotal, 2)} goes
            </SectionHeading>
            <p className="max-w-[440px] text-lg leading-relaxed text-slate">
              {e.hours} hours at {formatRupees(e.hourly)} an hour, at a normal hour. The driver pays
              the owner’s price plus GST on our fee. The owner gets their price less{' '}
              {PRICING.commissionPercent}%.
            </p>
          </div>
          <figure className="flex flex-[1_1_560px] flex-col gap-5">
            <div className="flex h-[120px] gap-1">
              {segments.map((s) => (
                <div
                  key={s.label}
                  style={{ flexGrow: s.amount }}
                  className={`flex min-w-[88px] basis-0 flex-col justify-end rounded-[4px] px-3 py-3.5 first:rounded-l-[10px] last:rounded-r-[10px] ${s.className}`}
                >
                  <span className={`type-figure ${s.size}`}>
                    <Rupees amount={s.amount} decimals={s.amount % 1 === 0 ? 0 : 2} />
                  </span>
                  <span className="text-[13px] font-bold">{s.label}</span>
                </div>
              ))}
            </div>
            <figcaption className="text-[15px] text-slate">
              At a busy hour, the extra charge goes on top for the driver. The owner still gets{' '}
              {formatRupees(e.owner)}.
            </figcaption>
          </figure>
        </div>
      </section>
      <section aria-labelledby="tables-title" className="bg-paper">
        <div className="wrap flex flex-col gap-14 py-28">
          <SectionHeading id="tables-title">For everyone on ParkEase</SectionHeading>
          <PricingTable />
          <p className="text-slate">
            Cancellations and refunds are covered in the{' '}
            <Link className="text-link" href="/legal/refunds">
              refund policy
            </Link>
            .
          </p>
        </div>
      </section>
      <CtaBand title="See the price on the map." />
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';

import { CtaBand } from '@/components/sections/CtaBand';
import { HowItWorks } from '@/components/sections/HowItWorks';
import { PageHero } from '@/components/sections/PageHero';
import { ParkingFloor } from '@/components/sections/ParkingFloor';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { MAP_ATTRIBUTION } from '@/components/sections/StreetMap';
import { JsonLd } from '@/components/ui/JsonLd';
import { estimateMonthlyEarnings } from '@/lib/earnings';
import { softwareApplicationJsonLd } from '@/lib/jsonld';
import { PAGES } from '@/lib/pages';
import { formatRupees, PRICING } from '@/lib/pricing';
import { qrPatternPath } from '@/lib/qr';
import { withRupee } from '@/lib/rupee';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.home);

const EXAMPLE = { hourlyPrice: 30, hoursPerDay: 6 } as const;

export default function HomePage() {
  const example = estimateMonthlyEarnings({ ...EXAMPLE, commissionRate: PRICING.commissionRate });
  return (
    <>
      <JsonLd data={softwareApplicationJsonLd()} />
      <PageHero
        home
        lines={['Stop circling', 'the block.']}
        lead="See which driveways and basements near you have a slot free right now, and book it before you leave home."
        actions={
          <>
            <Link className="btn btn-light" href="#get-the-app">
              Get the app
            </Link>
            <Link className="btn btn-outline-light" href="/how-it-works">
              How it works
            </Link>
          </>
        }
      />
      <section aria-label="Parking floor" className="bg-midnight">
        <ParkingFloor />
      </section>

      <section aria-labelledby="story-title" className="pt-36">
        <div className="wrap flex flex-col gap-16 pb-32">
          <SectionHeading id="story-title" className="max-w-[820px]">
            Three moves, from your sofa to the gate.
          </SectionHeading>
          <HowItWorks
            qrPath={qrPatternPath()}
            map={
              <img
                src="/maps/indiranagar-light.svg"
                alt=""
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            }
            mapAttribution={MAP_ATTRIBUTION}
            amounts={{
              ownerCancelGoodwill: formatRupees(PRICING.refunds.ownerCancelGoodwill),
              valetFee: `${formatRupees(PRICING.valet.base)} plus ${formatRupees(PRICING.valet.perKm)} a km`,
              exampleHours: PRICING.example.hours,
              exampleTotal: formatRupees(PRICING.example.driverTotal, 2),
            }}
          />
        </div>
      </section>

      <section aria-labelledby="owners-title" className="bg-paper">
        <div className="wrap flex flex-wrap items-center gap-x-22 gap-y-12 py-32">
          <div className="flex flex-[1_1_480px] flex-col gap-5">
            <SectionHeading id="owners-title">Got a space nobody parks in?</SectionHeading>
            <p className="max-w-[480px] text-[19px] leading-normal text-slate">
              Rent it out by the hour. The first {PRICING.waiverSlots} owners pay no commission for{' '}
              {PRICING.waiverMonths} months.
            </p>
            <Link className="btn btn-primary self-start" href="/earn">
              See what you’d earn
            </Link>
          </div>
          <figure className="flex flex-[0_1_400px] flex-col gap-2.5 rounded-[20px] bg-midnight p-8 text-on-midnight shadow-[0_30px_60px_-30px_var(--pe-shadow)]">
            <span className="text-[15px] font-bold text-on-midnight-muted">Example month</span>
            <span className="type-figure text-8xl">{withRupee(formatRupees(example))}</span>
            <figcaption className="mt-1.5 border-t border-midnight-rule pt-3.5 text-[15px] leading-normal text-on-midnight-muted">
              One slot at ₹{EXAMPLE.hourlyPrice} an hour, booked {EXAMPLE.hoursPerDay} hours a day,
              after the {PRICING.commissionPercent}% ParkEase commission.
            </figcaption>
          </figure>
        </div>
      </section>

      <CtaBand id="get-the-app" title="Bay 16 is still free." />
    </>
  );
}

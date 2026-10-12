import type { Metadata } from 'next';
import Link from 'next/link';

import { CtaBand } from '@/components/sections/CtaBand';
import { EarningsCalculator } from '@/components/sections/EarningsCalculator';
import { NumberedSteps } from '@/components/sections/NumberedSteps';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { PAGES } from '@/lib/pages';
import { PRICING } from '@/lib/pricing';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.earn);

export default function EarnPage() {
  return (
    <>
      <PageHero
        lines={['Your driveway', 'sits empty', 'from 9 to 6.']}
        lead="Rent it to someone who works nearby. You set the price and the hours; ParkEase finds the drivers and pays you weekly or monthly, whichever you choose."
        actions={
          <>
            <Link className="btn btn-light" href="#start">
              List your space
            </Link>
            <Link className="btn btn-outline-light" href="#estimate">
              Work out what you’d earn
            </Link>
          </>
        }
        aside={
          <div className="w-full flex-[0_1_320px] rounded-xl bg-primary p-2 text-on-primary shadow-[0_24px_48px_-20px_var(--pe-shadow)]">
            <div className="flex flex-col gap-2 rounded-[7px] border-[2.5px] border-on-primary px-5.5 pt-5.5 pb-5">
              <h2 id="offer-title" className="type-figure text-8xl">
                0%
              </h2>
              <p className="font-display text-3xl leading-none font-extrabold">
                commission for {PRICING.waiverMonths} months
              </p>
              <p className="mt-2 leading-normal">
                For the first {PRICING.waiverSlots} owners. Drivers pay the same price; ParkEase
                covers our share.
              </p>
            </div>
          </div>
        }
      />
      <section id="estimate" aria-labelledby="estimate-title" className="bg-paper">
        <div className="wrap flex flex-col gap-14 py-32">
          <SectionHeading id="estimate-title">How much could you earn?</SectionHeading>
          <EarningsCalculator
            commissionRate={PRICING.commissionRate}
            waiverSlots={PRICING.waiverSlots}
            waiverMonths={PRICING.waiverMonths}
            minimumPayout={PRICING.minimumPayout}
          />
        </div>
      </section>
      <section id="start" aria-labelledby="steps-title">
        <div className="wrap flex flex-col gap-14 py-32">
          <SectionHeading id="steps-title">Listed in an afternoon</SectionHeading>
          <NumberedSteps
            steps={[
              {
                title: 'Add your space',
                body: 'Pin the gate, add photos, count the slots. Listing is free.',
              },
              {
                title: 'Set price and hours',
                body: 'Per hour, per vehicle type. Change them any time.',
              },
              {
                title: 'Connect your bank',
                body: 'PAN and account go straight to Razorpay. We never store them.',
              },
              {
                title: 'Scan drivers in',
                body: 'Scan the code on their booking in the app and the booking starts.',
              },
            ]}
          />
          <p className="text-slate">
            Questions about payouts or cancellations?{' '}
            <Link className="font-bold text-primary underline" href="/faq#owners">
              Owner FAQ
            </Link>
          </p>
        </div>
      </section>
      <CtaBand title={`Take one of the ${String(PRICING.waiverSlots)} free places.`} />
    </>
  );
}

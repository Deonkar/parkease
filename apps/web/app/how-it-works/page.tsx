import type { Metadata } from 'next';
import Link from 'next/link';

import { CtaBand } from '@/components/sections/CtaBand';
import { FactList } from '@/components/sections/FactList';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { Tabs } from '@/components/sections/Tabs';
import { Badge } from '@/components/ui/Badge';
import { PAGES } from '@/lib/pages';
import { PRICING } from '@/lib/pricing';
import { formatRupees } from '@/lib/rupee';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.howItWorks);

interface Stage {
  readonly title: string;
  readonly body: string;
  readonly note: string;
}

const DRIVER: readonly Stage[] = [
  {
    title: 'Drop a pin where you’re going',
    body: 'Choose car or two-wheeler. The map shows only spaces that fit, and green ones have a slot free right now.',
    note: 'Availability is live, never cached',
  },
  {
    title: 'Pick a space',
    body: 'Each one shows photos, its rating, the walk to your pin and the hourly price.',
    note: 'Reviews come only from completed bookings',
  },
  {
    title: 'Book and pay',
    body: 'Choose your hours and see the total, itemised, before you pay with UPI, card or netbanking.',
    note: 'Payments by Razorpay',
  },
  {
    title: 'Show your pass at the gate',
    body: 'The owner scans the code on your booking and you’re checked in.',
    note: 'Add a valet or a wash before you arrive',
  },
  {
    title: 'Drive out and rate it',
    body: 'Leave when your time’s up and tell the next driver what the space was like.',
    note: 'Owners rate drivers too',
  },
];

const OWNER: readonly Stage[] = [
  {
    title: 'Add your space',
    body: 'Pin the gate, add photos, and count your car and two-wheeler slots.',
    note: 'Listing is free',
  },
  {
    title: 'Set price and hours',
    body: 'An hourly price for each vehicle type and the hours you’re open. Change them whenever you like.',
    note: 'Busy-hour charges never cut into your price',
  },
  {
    title: 'Connect your bank',
    body: 'Your PAN and account number go straight to Razorpay to set up payouts.',
    note: 'ParkEase never stores them',
  },
  {
    title: 'Scan drivers in',
    body: 'When a driver arrives, scan the code on their booking with the app and the booking starts.',
    note: 'You can rate every driver',
  },
  {
    title: 'Get paid weekly or monthly',
    body: `Your share lands in your bank ${PRICING.payouts.sentence}, once you’ve earned at least ${formatRupees(PRICING.minimumPayout)}.`,
    note: `${String(PRICING.commissionPercent)}% commission, or 0% for the first ${String(PRICING.waiverSlots)} owners for ${String(PRICING.waiverMonths)} months`,
  },
];

function Timeline({ stages }: { readonly stages: readonly Stage[] }) {
  return (
    <div className="relative pl-16 md:pl-24">
      <div
        aria-hidden="true"
        className="absolute top-3 bottom-3 left-[22px] w-[3px] bg-primary md:left-[30px]"
      />
      <ol className="flex flex-col gap-14">
        {stages.map((stage, i) => (
          <li key={stage.title} className="relative flex flex-wrap items-baseline gap-x-12 gap-y-3">
            <span
              aria-hidden="true"
              className="absolute -top-1 -left-16 flex size-12 items-center justify-center rounded-full bg-paper font-stencil text-[26px] md:-top-1.5 md:-left-24 md:size-16 md:text-[34px] font-extrabold text-primary shadow-[inset_0_0_0_3px_var(--pe-primary)]"
            >
              {i + 1}
            </span>
            <h2 className="font-display text-[clamp(26px,2.6vw,36px)] leading-[0.95] font-extrabold md:flex-[0_1_380px]">
              {stage.title}
            </h2>
            <div className="flex flex-[1_1_380px] flex-col gap-2.5">
              <p className="max-w-[560px] text-lg leading-relaxed text-slate">{stage.body}</p>
              <span className="self-start">
                <Badge>{stage.note}</Badge>
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        lines={['One empty bay,', 'two sides.']}
        lead="Drivers need somewhere to park. Owners have somewhere nobody’s parking. Here’s exactly what each of you does, and what ParkEase does in between."
      />
      <section aria-label="Steps" className="bg-midnight pb-6 text-on-midnight">
        <div className="wrap">
          <Tabs
            label="Show steps for"
            items={[
              {
                id: 'drivers',
                label: 'I’m parking',
                content: (
                  <div className="rounded-t-3xl bg-porcelain px-6 py-16 text-ink md:px-12">
                    <Timeline stages={DRIVER} />
                  </div>
                ),
              },
              {
                id: 'owners',
                label: 'I’m listing a space',
                content: (
                  <div className="rounded-t-3xl bg-porcelain px-6 py-16 text-ink md:px-12">
                    <Timeline stages={OWNER} />
                  </div>
                ),
              },
            ]}
          />
        </div>
      </section>
      <section aria-labelledby="if-title" className="bg-paper">
        <div className="wrap flex flex-wrap gap-x-22 gap-y-10 py-28">
          <SectionHeading id="if-title" className="max-w-[420px] flex-[1_1_320px]">
            When things don’t go to plan
          </SectionHeading>
          <FactList
            className="flex-[1_1_560px]"
            items={[
              {
                term: 'The owner cancels on you',
                detail: `Every rupee back at any hour, plus ${formatRupees(PRICING.refunds.ownerCancelGoodwill)} from ParkEase. It never comes out of the owner’s earnings or yours.`,
              },
              {
                term: 'You need to cancel',
                detail: (
                  <>
                    All but {formatRupees(PRICING.refunds.processingFee)} back before your start
                    time, {PRICING.refunds.gracePercent}% back in the first{' '}
                    {PRICING.refunds.graceMinutes} minutes.{' '}
                    <Link className="text-link" href="/legal/refunds">
                      Refund policy
                    </Link>
                  </>
                ),
              },
              {
                term: 'It’s a busy hour',
                detail: (
                  <>
                    A busy-hour charge can apply when an area is nearly full. You see it before you
                    book, and owners never lose any of their price to it.{' '}
                    <Link className="text-link" href="/pricing">
                      Pricing
                    </Link>
                  </>
                ),
              },
            ]}
          />
        </div>
      </section>
      <CtaBand title="Pick a side. Get the app." />
    </>
  );
}

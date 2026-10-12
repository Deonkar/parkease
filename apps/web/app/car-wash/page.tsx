import type { Metadata } from 'next';
import Link from 'next/link';

import { CtaBand } from '@/components/sections/CtaBand';
import { NumberedSteps } from '@/components/sections/NumberedSteps';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { ServiceSwitch } from '@/components/sections/ServiceSwitch';
import { WashProof } from '@/components/sections/WashProof';
import { PAGES } from '@/lib/pages';
import { PRICING } from '@/lib/pricing';
import { formatRupees } from '@/lib/rupee';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.carWash);

/** The closed v1 service catalogue (CARWASH_SERVICE_NAME_VALUES in @parkease/contracts). */
const SERVICES = [
  ['Quick wipe', 'A fast clean of the body and glass'],
  ['Basic exterior', 'A full wash of the outside'],
  [
    'Premium wash',
    `A deeper outside clean, for example ${formatRupees(PRICING.wash.examplePrice)}`,
  ],
  ['Interior only', 'Inside the car, not outside'],
  ['Full detailing', 'Inside and out, in depth'],
] as const;

export default function CarWashPage() {
  return (
    <>
      <PageHero
        before={<ServiceSwitch current="car-wash" />}
        lines={['Come back to', 'a clean car.']}
        lead="Add a wash to your booking and a local partner cleans the car in your bay while you’re at work, the match, or dinner."
      />
      <section aria-labelledby="proof-title">
        <div className="wrap flex flex-wrap items-center gap-x-20 gap-y-12 py-28">
          <div className="flex flex-[1_1_360px] flex-col gap-4">
            <SectionHeading id="proof-title">Photos before and after, every time.</SectionHeading>
            <p className="max-w-[440px] text-lg leading-relaxed text-slate">
              Your partner photographs the car when they start and when they finish. Both land on
              your phone, timed, so you can see the work.
            </p>
          </div>
          <WashProof />
        </div>
      </section>
      <section aria-labelledby="menu-title" className="bg-paper">
        <div className="wrap flex flex-wrap gap-x-22 gap-y-10 py-28">
          <div className="flex max-w-[420px] flex-[1_1_320px] flex-col gap-4">
            <SectionHeading id="menu-title">Five washes, one menu</SectionHeading>
            <p className="text-[17px] leading-relaxed text-slate">
              Each partner sets their own prices for the washes they offer. You see the price before
              you add one.
            </p>
          </div>
          <ul className="flex-[1_1_560px] border-y-2 border-ink">
            {SERVICES.map(([name, description], i) => (
              <li
                key={name}
                className={`flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-5.5 ${i > 0 ? 'border-t border-rule' : ''}`}
              >
                <span className="type-card">{name}</span>
                <span className="text-slate">{description}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section aria-labelledby="away-title">
        <div className="wrap flex flex-col gap-12 py-28">
          <SectionHeading id="away-title">While you’re away</SectionHeading>
          <NumberedSteps
            steps={[
              { title: 'Add a wash', body: 'Pick one from the partner’s menu on your booking.' },
              { title: 'A partner comes to your bay', body: 'No queue and no driving to a wash.' },
              { title: 'Photos land on your phone', body: 'Before and after, then rate the wash.' },
            ]}
          />
          <p className="text-slate">
            Run a car wash? Partners keep {PRICING.wash.keepsPercent}% of every job.{' '}
            <Link className="text-link" href="/partners#car-wash">
              How partnering works
            </Link>
          </p>
        </div>
      </section>
      <CtaBand title="Park dirty. Leave clean." />
    </>
  );
}

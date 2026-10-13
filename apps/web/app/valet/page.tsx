import type { Metadata } from 'next';
import Link from 'next/link';

import { CtaBand } from '@/components/sections/CtaBand';
import { FactList } from '@/components/sections/FactList';
import { NumberedSteps } from '@/components/sections/NumberedSteps';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { ServiceSwitch } from '@/components/sections/ServiceSwitch';
import { PAGES } from '@/lib/pages';
import { PRICING } from '@/lib/pricing';
import { formatRupees, Rupees } from '@/lib/rupee';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.valet);

export default function ValetPage() {
  const v = PRICING.valet;
  return (
    <>
      <PageHero
        before={<ServiceSwitch current="valet" />}
        lines={['Hand over the keys', 'at the door.']}
        lead="Add a valet to any booking. They meet you where you stop, park at the bay you booked, and bring the car back when you ask for it."
        aside={
          <div className="flex flex-[0_1_320px] flex-col gap-1.5 rounded-[20px] bg-midnight-raised p-6.5 shadow-[inset_0_0_0_1px_var(--pe-midnight-rule)]">
            <span className="type-figure text-6xl">
              <Rupees amount={v.base} />
            </span>
            <span className="text-[17px] font-bold">
              plus {formatRupees(v.perKm)} a km, each way
            </span>
            <span className="mt-2 border-t border-midnight-rule pt-3 text-[15px] leading-normal text-on-midnight-muted">
              A {v.exampleKm} km trip comes to {formatRupees(v.exampleFee)}, plus GST on the
              ParkEase share.
            </span>
          </div>
        }
      />
      <section aria-labelledby="route-title">
        <div className="wrap flex flex-col gap-14 py-32">
          <SectionHeading id="route-title">Door, bay, door.</SectionHeading>
          <NumberedSteps
            steps={[
              {
                title: 'You pull up',
                body: 'Your valet is on the map as they head to you. Hand over the keys and go.',
              },
              {
                title: 'They park at your bay',
                body: 'The car goes to the space you booked, and you see when it’s in.',
              },
              {
                title: 'Tap to get it back',
                body: 'Ask for the car when you’re ready and watch it come to you.',
              },
            ]}
          />
        </div>
      </section>
      <section aria-labelledby="know-title" className="bg-paper">
        <div className="wrap flex flex-wrap gap-x-22 gap-y-10 py-28">
          <SectionHeading id="know-title" className="max-w-[420px] flex-[1_1_320px]">
            Good to know
          </SectionHeading>
          <FactList
            className="flex-[1_1_560px]"
            items={[
              {
                term: 'Every valet is verified',
                detail: 'Valets upload ID before they can take a job, and drivers rate every trip.',
              },
              {
                term: 'If you’re running late',
                detail: `The valet waits ${String(v.noShowGraceMinutes)} minutes. After that the ${formatRupees(v.base)} call-out is charged and the distance isn’t.`,
              },
              {
                term: 'Want to work as a valet?',
                detail: (
                  <>
                    Valets keep {v.keepsPercent}% of every trip and choose their own hours.{' '}
                    <Link className="text-link" href="/partners">
                      How partnering works
                    </Link>
                  </>
                ),
              },
            ]}
          />
        </div>
      </section>
      <CtaBand title="Add a valet to your next booking." />
    </>
  );
}

import type { Metadata } from 'next';

import { CtaBand } from '@/components/sections/CtaBand';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { PAGES } from '@/lib/pages';
import { PRICING } from '@/lib/pricing';
import { pageMetadata } from '@/lib/seo';
import { COMPANY, CONTACT } from '@/lib/site';

export const metadata: Metadata = pageMetadata(PAGES.about);

const PROMISES = [
  [
    'Green only ever means free.',
    'Not “saved”, not “success”. On ParkEase, green is a slot you can park in right now.',
  ],
  [
    'Every rupee, before anyone pays.',
    'Drivers see the full total. Owners see exactly what we keep. Nobody finds a fee afterwards.',
  ],
  [
    'Owners keep their price.',
    'Busy-hour charges go on top for the driver. They never come out of the rate an owner set.',
  ],
  [
    'When plans fall through, we pay.',
    `If an owner cancels, the driver gets everything back plus ₹${String(PRICING.refunds.ownerCancelGoodwill)} from ParkEase, not from the owner.`,
  ],
] as const;

export default function AboutPage() {
  return (
    <>
      <PageHero
        lines={['The city has parking.', 'Most of it is', 'behind a gate.']}
        lead="Office lots empty out at 7. Driveways sit idle from 9 to 6. Meanwhile the street outside is full. ParkEase lets the people who own those spaces rent them by the hour to the people circling past."
      />
      <section aria-labelledby="promises-title" className="bg-paper">
        <div className="wrap flex flex-col gap-10 py-28">
          <SectionHeading id="promises-title">What we hold ourselves to</SectionHeading>
          <div className="border-b border-rule">
            {PROMISES.map(([title, body]) => (
              <div
                key={title}
                className="flex flex-wrap items-baseline gap-x-12 gap-y-2 border-t border-rule py-7"
              >
                <p className="font-display text-[clamp(30px,3.4vw,48px)] leading-[0.95] font-black md:flex-[1_1_520px]">
                  {title}
                </p>
                <p className="max-w-[420px] flex-[1_1_320px] text-[17px] leading-relaxed text-slate">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section aria-labelledby="company-title">
        <div className="wrap flex flex-wrap gap-x-22 gap-y-10 py-28">
          <SectionHeading id="company-title" className="max-w-[420px] flex-[1_1_320px]">
            Who’s behind it
          </SectionHeading>
          <div className="flex flex-[1_1_560px] flex-col gap-10">
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-10">
              {[
                ['Who runs it', COMPANY.legalName],
                ...(COMPANY.cin === null ? [] : [['CIN', COMPANY.cin]]),
                ['Based in', COMPANY.address],
                ['Grievance officer', COMPANY.grievanceOfficer],
              ].map(([label, value]) => (
                <div key={label} className="border-t border-rule py-4.5">
                  <dt className="text-sm text-slate">{label}</dt>
                  <dd className="mt-1 text-lg font-bold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[17px] leading-relaxed">
              Writing about us? Email{' '}
              <a className="font-bold text-primary underline" href={`mailto:${CONTACT.press}`}>
                {CONTACT.press}
              </a>
              .
            </p>
          </div>
        </div>
      </section>
      <CtaBand title="Open a gate near you." />
    </>
  );
}

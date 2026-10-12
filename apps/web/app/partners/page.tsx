import type { Metadata } from 'next';

import { AppStoreBadges } from '@/components/sections/AppStoreBadges';
import { PageHero } from '@/components/sections/PageHero';
import { Tabs } from '@/components/sections/Tabs';
import { PAGES } from '@/lib/pages';
import { formatRupees, PRICING } from '@/lib/pricing';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.partners);

function Panel({
  figure,
  lead,
  example,
  points,
}: {
  readonly figure: string;
  readonly lead: string;
  readonly example: readonly [string, string, string];
  readonly points: readonly (readonly [string, string])[];
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-22 gap-y-12 rounded-t-3xl bg-porcelain px-6 py-16 text-ink md:px-12">
      <div className="flex flex-[1_1_420px] flex-col gap-4.5">
        <span className="type-figure text-[clamp(44px,5vw,72px)]">{figure}</span>
        <p className="max-w-[460px] text-[19px] leading-normal text-slate">{lead}</p>
        <div className="mt-2 flex gap-7 self-start rounded-[18px] bg-midnight px-6.5 py-5.5 text-on-midnight">
          <div>
            <p className="text-sm text-on-midnight-muted">{example[0]}</p>
            <p className="type-figure text-[44px]">{example[1]}</p>
          </div>
          <div>
            <p className="text-sm text-on-midnight-muted">You earn</p>
            <p className="type-figure text-[44px]">{example[2]}</p>
          </div>
        </div>
      </div>
      <ul className="flex-[1_1_440px] border-t-2 border-ink">
        {points.map(([title, body]) => (
          <li key={title} className="border-b border-rule py-5.5 text-[17px] leading-relaxed">
            <strong>{title}</strong> {body}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PartnersPage() {
  const v = PRICING.valet;
  const w = PRICING.wash;
  return (
    <>
      <PageHero
        lines={['Earn on your', 'own hours.']}
        lead="Valets and car wash businesses work through the same ParkEase app. Registration is free."
      />
      <section aria-label="Partner roles" className="bg-midnight text-on-midnight">
        <div className="wrap">
          <Tabs
            label="Choose your work"
            items={[
              {
                id: 'valet',
                label: 'I’m a valet',
                content: (
                  <Panel
                    figure={`Keep ${String(v.keepsPercent)}%`}
                    lead={`of every trip. Drivers pay ${formatRupees(v.base)} plus ${formatRupees(v.perKm)} a km to have their car parked or brought back.`}
                    example={[
                      `A ${String(v.exampleKm)} km trip`,
                      formatRupees(v.exampleFee),
                      formatRupees(v.exampleEarns),
                    ]}
                    points={[
                      [
                        'Work when you want.',
                        'Go online and offers near you come in. Each one waits 2 minutes for you to accept.',
                      ],
                      [
                        'Paid if they don’t show.',
                        `If the driver isn’t there ${String(v.noShowGraceMinutes)} minutes after you arrive, the ${formatRupees(v.base)} call-out is still charged and your share is yours.`,
                      ],
                      ['To start:', 'download ParkEase, choose Valet, and upload your ID.'],
                    ]}
                  />
                ),
              },
              {
                id: 'car-wash',
                label: 'I run a car wash',
                content: (
                  <Panel
                    figure="Your prices"
                    lead={`and ${String(w.keepsPercent)}% of each job. Wash cars where they’re already parked, while their drivers are away.`}
                    example={[
                      `A ${formatRupees(w.examplePrice)} premium wash`,
                      formatRupees(w.examplePrice),
                      formatRupees(w.exampleEarns),
                    ]}
                    points={[
                      [
                        'Five services, your menu.',
                        'Quick wipe, basic exterior, premium wash, interior only and full detailing. Offer the ones you do.',
                      ],
                      [
                        'Proof built in.',
                        'Take before and after photos in the app, so the driver sees the work.',
                      ],
                      [
                        'To start:',
                        'download ParkEase, choose Car wash, set your prices, and connect your bank through Razorpay.',
                      ],
                    ]}
                  />
                ),
              },
            ]}
          />
        </div>
      </section>
      <section aria-labelledby="join-title" className="bg-midnight text-on-midnight">
        <div className="wrap flex flex-wrap items-end justify-between gap-x-12 gap-y-8 py-28">
          <h2 id="join-title" className="type-cta flex-[1_1_560px]">
            One app. Pick your role inside.
          </h2>
          <AppStoreBadges />
        </div>
      </section>
    </>
  );
}

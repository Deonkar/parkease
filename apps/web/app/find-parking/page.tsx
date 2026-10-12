import type { Metadata } from 'next';
import Link from 'next/link';

import { CtaBand } from '@/components/sections/CtaBand';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { MAP_ATTRIBUTION, StreetMap } from '@/components/sections/StreetMap';
import { Badge } from '@/components/ui/Badge';
import { LAUNCHED_CITIES } from '@/lib/cities';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.findParking);

const POINTS = [
  {
    title: 'How many slots are free right now',
    body: 'Live, per vehicle type. Green only ever means free.',
  },
  {
    title: 'The price, and the full total',
    body: 'Hourly rate on the map, every rupee itemised at checkout.',
  },
  {
    title: 'Photos and reviews',
    body: 'From the owner, and from drivers who actually parked there.',
  },
  { title: 'How far you’ll walk', body: 'Measured from the gate to the pin you dropped.' },
] as const;

export default function FindParkingPage() {
  return (
    <>
      <PageHero
        lines={['Parking near', 'wherever you’re', 'going.']}
        lead="Driveways, apartment basements and private lots, listed by the people who own them and bookable by the hour."
        actions={
          <>
            <Link className="btn btn-light" href="#get-the-app">
              Get the app
            </Link>
            <Link className="btn btn-outline-light" href="/how-it-works">
              How booking works
            </Link>
          </>
        }
        aside={
          <figure className="relative h-[460px] w-full flex-[1_1_480px] overflow-hidden rounded-[28px] shadow-[inset_0_0_0_1px_var(--pe-midnight-rule),0_40px_80px_-40px_var(--pe-shadow)] md:h-[520px]">
            <StreetMap theme="dark" pinScale={2.2} animatePins />
            <figcaption className="absolute right-3.5 bottom-2.5 text-[11px] text-on-midnight-muted">
              {MAP_ATTRIBUTION}
            </figcaption>
          </figure>
        }
      />

      <section aria-labelledby="see-title">
        <div className="wrap flex flex-col gap-14 py-32">
          <SectionHeading id="see-title" className="max-w-[760px]">
            Everything you need to know, before you pay.
          </SectionHeading>
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-10 gap-y-8">
            {POINTS.map((point, i) => (
              <li key={point.title} className="flex gap-4 border-t-2 border-ink pt-5">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-extrabold text-on-primary"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="mb-1 text-[19px] font-extrabold">{point.title}</h3>
                  <p className="leading-relaxed text-slate">{point.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="two-wheelers-title" className="bg-paper">
        <div className="wrap flex flex-wrap items-center gap-x-22 gap-y-10 py-28">
          <div className="flex flex-[1_1_420px] flex-col gap-4">
            <SectionHeading id="two-wheelers-title">Two-wheelers welcome.</SectionHeading>
            <p className="max-w-[480px] text-lg leading-relaxed text-slate">
              Owners list car and two-wheeler slots separately, each with its own price. Switch the
              map to two-wheeler and you’ll only see bays that take one.
            </p>
          </div>
          <div
            aria-hidden="true"
            className="flex w-full flex-[0_1_420px] flex-col gap-3 rounded-3xl bg-porcelain p-[18px] shadow-[inset_0_0_0_1px_var(--pe-rule)]"
          >
            <div className="flex gap-1.5 rounded-xl bg-paper p-1 text-[15px] font-bold">
              <span className="flex h-10 flex-1 items-center justify-center text-slate">Car</span>
              <span className="flex h-10 flex-1 items-center justify-center rounded-[9px] bg-ink text-paper">
                Two-wheeler
              </span>
            </div>
            {[
              ['Covered basement, 12th Main', '6 two-wheeler slots free', '₹15/hr'],
              ['Gated driveway, 4th Cross', '2 two-wheeler slots free', '₹10/hr'],
            ].map(([name, free, price]) => (
              <div
                key={name}
                className="flex items-center justify-between gap-3 rounded-[14px] bg-paper p-4"
              >
                <div>
                  <p className="font-extrabold">{name}</p>
                  <div className="mt-1.5">
                    <Badge tone="free">{free}</Badge>
                  </div>
                </div>
                <span className="type-figure text-[26px] whitespace-nowrap">{price}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="cities-title">
        <div className="wrap flex flex-col gap-8 py-28">
          <SectionHeading id="cities-title">Where we are</SectionHeading>
          <ul className="flex flex-wrap gap-2.5">
            {LAUNCHED_CITIES.map((city) => (
              <li key={city.slug}>
                <Link
                  href={`/${city.slug}`}
                  className="inline-flex h-[52px] items-center rounded-full border-[1.5px] border-rule bg-paper px-5 text-[17px] font-bold text-ink no-underline hover:border-ink"
                >
                  Parking in {city.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <CtaBand id="get-the-app" title="Book before you leave home." />
    </>
  );
}

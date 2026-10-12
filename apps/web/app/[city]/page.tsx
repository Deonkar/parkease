import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CityNeighbourhoods } from '@/components/sections/CityNeighbourhoods';
import { CityStats } from '@/components/sections/CityStats';
import { CtaBand } from '@/components/sections/CtaBand';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { cityDescription, cityTitle, findCity, LAUNCHED_CITIES, type CitySlug } from '@/lib/cities';
import { PRICING } from '@/lib/pricing';

interface CityParams {
  readonly city: CitySlug;
}

export function generateStaticParams(): CityParams[] {
  return LAUNCHED_CITIES.map((c) => ({ city: c.slug }));
}

/**
 * Unknown slugs 404 instead of rendering an empty city page that gets indexed. Changing a city
 * URL after indexing costs redirects and rankings, so this is settled now (task 20 §20.4).
 */
export const dynamicParams = false;

/** Rebuilt once a day so city copy can follow the data without a deploy. */
export const revalidate = 86_400;

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<CityParams>;
}): Promise<Metadata> {
  const city = findCity((await params).city);
  if (city === undefined) return {};
  const path = `/${city.slug}`;
  return {
    title: cityTitle(city),
    description: cityDescription(city),
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      siteName: 'ParkEase',
      url: path,
      title: `Parking in ${city.name} — ParkEase`,
      description: `${city.vehicleCount} vehicles, not enough parking. ParkEase connects drivers with private parking spaces in ${city.name}.`,
    },
  };
}

export default async function CityPage({ params }: { readonly params: Promise<CityParams> }) {
  const city = findCity((await params).city);
  if (city === undefined) notFound();

  return (
    <>
      <PageHero
        before={
          <nav aria-label="Breadcrumb" className="text-[15px] text-on-midnight-muted">
            <Link
              className="underline underline-offset-4 hover:text-on-midnight"
              href="/find-parking"
            >
              Find parking
            </Link>{' '}
            / <span aria-current="page">{city.name}</span>
          </nav>
        }
        lines={['Parking in', `${city.name}.`]}
        lead={`Private driveways, basements and lots across ${city.name}, bookable by the hour. See what’s free before you set off.`}
        actions={
          <>
            <Link className="btn btn-light" href="#get-the-app">
              Get the app
            </Link>
            <Link className="btn btn-outline-light" href="/earn">
              List a space
            </Link>
          </>
        }
      />
      <CityStats city={city} />
      <CityNeighbourhoods city={city} />
      <section aria-labelledby="own-title" className="bg-paper">
        <div className="wrap flex flex-wrap items-start gap-x-22 gap-y-10 py-28">
          <div className="flex flex-[1_1_480px] flex-col gap-5">
            <SectionHeading id="own-title">Got a space in {city.name}?</SectionHeading>
            <p className="max-w-[520px] text-lg leading-relaxed text-slate">
              List it free, set your own price and hours, and get paid every Monday. ParkEase keeps{' '}
              {PRICING.commissionPercent}%, and nothing at all for the first {PRICING.waiverMonths}{' '}
              months if you’re one of the first {PRICING.waiverSlots} owners.
            </p>
            <div>
              <Link className="btn btn-primary" href="/earn#estimate">
                See what you’d earn
              </Link>
            </div>
          </div>
          <ul className="flex flex-[1_1_420px] flex-col border-b border-rule">
            <li className="border-t border-rule py-5 text-lg">
              <strong>Drivers</strong>{' '}
              <span className="text-slate">book by the hour and see the full price first.</span>{' '}
              <Link className="font-bold text-primary underline" href="/how-it-works">
                How it works
              </Link>
            </li>
            <li className="border-t border-rule py-5 text-lg">
              <strong>Owners</strong>{' '}
              <span className="text-slate">scan drivers in with their phone.</span>
            </li>
            <li className="border-t border-rule py-5 text-lg">
              <strong>Valets and wash partners</strong>{' '}
              <span className="text-slate">keep {PRICING.valet.keepsPercent}% of every job.</span>{' '}
              <Link className="font-bold text-primary underline" href="/partners">
                Work with us
              </Link>
            </li>
          </ul>
        </div>
      </section>
      <CtaBand id="get-the-app" title={`Find a bay in ${city.name}.`} />
    </>
  );
}

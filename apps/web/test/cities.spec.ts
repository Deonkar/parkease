import { describe, expect, it } from 'vitest';

import * as cityRoute from '@/app/[city]/page';
import { LAUNCHED_CITIES } from '@/lib/cities';

describe('city pages', () => {
  it('generateStaticParams returns exactly the launched cities', () => {
    expect(cityRoute.generateStaticParams()).toEqual([
      { city: 'bangalore' },
      { city: 'delhi' },
      { city: 'mumbai' },
    ]);
    expect(LAUNCHED_CITIES.map((c) => c.slug)).toEqual(['bangalore', 'delhi', 'mumbai']);
  });

  it('404s unknown slugs instead of rendering an empty city page', () => {
    expect(cityRoute.dynamicParams).toBe(false);
  });

  it('puts the city name in the title and the vehicle count in og:description', async () => {
    for (const city of LAUNCHED_CITIES) {
      const metadata = await cityRoute.generateMetadata({
        params: Promise.resolve({ city: city.slug }),
      });
      expect(metadata.title).toBe(`Parking in ${city.name} — Find & Book Spots`);
      expect(metadata.alternates?.canonical).toBe(`/${city.slug}`);
      expect(metadata.openGraph?.title).toBe(`Parking in ${city.name} — ParkEase`);
      expect(metadata.openGraph?.description).toContain(city.vehicleCount);
    }
  });
});

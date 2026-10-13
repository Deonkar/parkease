/**
 * Launched cities. City pages sit at the root (`/bangalore`), so a slug here is a URL that
 * gets indexed; renaming one later costs redirects and rankings (structure.md §7, seo.md §2.1).
 */
export const LAUNCHED_CITIES = [
  {
    slug: 'bangalore' as const,
    name: 'Bangalore',
    vehicleCount: '8M+',
    neighbourhoods: ['Koramangala', 'HSR Layout', 'Indiranagar', 'Whitefield', 'Jayanagar'],
  },
  {
    slug: 'delhi' as const,
    name: 'Delhi',
    vehicleCount: '12M+',
    neighbourhoods: ['Connaught Place', 'Karol Bagh', 'Dwarka', 'Noida', 'Gurgaon'],
  },
  {
    slug: 'mumbai' as const,
    name: 'Mumbai',
    vehicleCount: '4M+',
    neighbourhoods: ['Andheri', 'Bandra', 'Lower Parel', 'Powai', 'BKC'],
  },
] as const;

export type City = (typeof LAUNCHED_CITIES)[number];
export type CitySlug = City['slug'];

export function findCity(slug: string): City | undefined {
  return LAUNCHED_CITIES.find((c) => c.slug === slug);
}

export function cityTitle(city: City): string {
  return `Parking in ${city.name} — Find & Book Spots`;
}

export function cityDescription(city: City): string {
  return `Find parking spaces in ${city.name}. Book hourly, daily, weekly, or monthly. List your empty space and earn passive income.`;
}

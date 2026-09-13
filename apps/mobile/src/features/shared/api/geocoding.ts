import { z } from 'zod';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Nominatim's usage policy requires an identifying User-Agent.
const USER_AGENT = 'ParkEase/1.0 (parking marketplace; contact@parkease.in)';

const nominatimAddressSchema = z.object({
  road: z.string().optional(),
  suburb: z.string().optional(),
  neighbourhood: z.string().optional(),
  city: z.string().optional(),
  town: z.string().optional(),
  village: z.string().optional(),
  state_district: z.string().optional(),
  postcode: z.string().optional(),
});

const nominatimPlaceSchema = z.object({
  place_id: z.number(),
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
  name: z.string().optional(),
  address: nominatimAddressSchema.optional(),
});

const nominatimResponseSchema = z.array(nominatimPlaceSchema);

export interface PlaceSuggestion {
  id: string;
  /** Short label, e.g. "Koregaon Park" */
  title: string;
  /** Full address for the secondary line */
  subtitle: string;
  lat: number;
  lng: number;
  city?: string;
  pincode?: string;
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'in');
  url.searchParams.set('limit', '6');

  const response = await fetch(url.toString(), {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Place search failed (${String(response.status)})`);
  }

  const places = nominatimResponseSchema.parse(await response.json());

  return places.map((place) => {
    const address = place.address;
    const title = place.name ?? place.display_name.split(',')[0] ?? place.display_name;
    const suggestion: PlaceSuggestion = {
      id: String(place.place_id),
      title,
      subtitle: place.display_name,
      lat: Number(place.lat),
      lng: Number(place.lon),
    };
    const city = address?.city ?? address?.town ?? address?.village ?? address?.state_district;
    if (city) suggestion.city = city;
    if (address?.postcode) suggestion.pincode = address.postcode;
    return suggestion;
  });
}

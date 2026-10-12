/**
 * Blog posts. The MDX body lives in content/blog/<slug>.mdx and is loaded through lib/mdx.ts;
 * this registry carries what listings, metadata and the sitemap need without compiling MDX.
 */
export type BlogCategory = 'Drivers' | 'Owners';

export interface BlogPost {
  readonly slug: string;
  readonly title: string;
  /** Used for the meta description and the listing excerpt, so 100–160 characters. */
  readonly description: string;
  readonly category: BlogCategory;
  /** ISO date, YYYY-MM-DD. */
  readonly published: string;
  readonly minutes: number;
}

export const BLOG_POSTS = [
  {
    slug: 'first-basement-booking',
    title: 'Your first basement booking, start to finish',
    description:
      'What to check before you go, what happens at the gate, and what to do if plans change: a first ParkEase booking from the map to the exit.',
    category: 'Drivers',
    published: '2026-10-07',
    minutes: 4,
  },
  {
    slug: 'car-or-two-wheeler',
    title: 'Car or two-wheeler: how slots are listed',
    description:
      'Why the ParkEase map changes when you switch vehicle type, how owners price car and two-wheeler bays separately, and what that means for you.',
    category: 'Drivers',
    published: '2026-10-07',
    minutes: 3,
  },
  {
    slug: 'what-the-commission-pays-for',
    title: 'What the 15% commission pays for',
    description:
      'Where the ParkEase commission goes: payments, payouts, support, and the goodwill we pay drivers when an owner has to cancel a booking.',
    category: 'Owners',
    published: '2026-10-07',
    minutes: 4,
  },
] as const satisfies readonly BlogPost[];

export type BlogSlug = (typeof BLOG_POSTS)[number]['slug'];

export function findPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function formatPostDate(iso: string): string {
  return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

import { PRICING } from '@/lib/pricing';

/**
 * Every static page: its path, title and meta description. Metadata, the sitemap and the
 * build-output checks all read from here, so a page cannot ship without a unique title and a
 * 100–160 character description (task 20 §20.12). No superlatives (website.md §1).
 */
export interface PageMeta {
  readonly path: string;
  /** Rendered through the layout's `%s — ParkEase` template unless `absolute` is set. */
  readonly title: string;
  readonly absolute?: boolean;
  readonly description: string;
}

export const PAGES = {
  home: {
    path: '/',
    title: 'ParkEase — Find & Rent Parking in India',
    absolute: true,
    description:
      'Find and book parking spaces across India. List your space and earn passive income. Valet and car wash services included.',
  },
  howItWorks: {
    path: '/how-it-works',
    title: 'How It Works',
    description:
      'How ParkEase works for drivers and space owners: find a free slot, book by the hour, show your pass at the gate, and get paid weekly or monthly.',
  },
  earn: {
    path: '/earn',
    title: 'Earn From Your Parking Space',
    description: `List a driveway, basement bay or private lot on ParkEase. Set your own price and hours, keep ${String(PRICING.ownerKeepsPercent)}% of every booking and get paid weekly or monthly.`,
  },
  findParking: {
    path: '/find-parking',
    title: 'Find Parking Near You',
    description:
      'See which driveways, basements and private lots near you have a slot free right now, for cars and two-wheelers, and book it by the hour.',
  },
  valet: {
    path: '/valet',
    title: 'Valet Parking',
    description:
      'Add a valet to any ParkEase booking. They meet you at the door, park at the bay you booked and bring the car back when you ask for it.',
  },
  carWash: {
    path: '/car-wash',
    title: 'Car Wash While You Park',
    description:
      'Add a car wash to your ParkEase booking and a local partner cleans the car in your bay, with photos before and after sent to your phone.',
  },
  pricing: {
    path: '/pricing',
    title: 'Pricing',
    description:
      'ParkEase pricing for drivers, space owners, valets and car wash partners. One fee, shown before you pay, and no platform fee for drivers.',
  },
  faq: {
    path: '/faq',
    title: 'Frequently Asked Questions',
    description:
      'Answers to common questions from drivers and space owners about booking, pricing, refunds, payouts, reviews and the cities ParkEase covers.',
  },
  about: {
    path: '/about',
    title: 'About ParkEase',
    description:
      'ParkEase lets people rent out the driveways, basements and private lots they are not using, by the hour, to drivers who need a place to park.',
  },
  contact: {
    path: '/contact',
    title: 'Contact Us',
    description:
      'Contact ParkEase support for help with bookings, listings, payouts, valet and car wash jobs, or reach our grievance officer and press team.',
  },
  blog: {
    path: '/blog',
    title: 'Blog',
    description:
      'Guides for drivers and space owners from ParkEase: booking a slot, listing your space, understanding pricing and parking in Indian cities.',
  },
  partners: {
    path: '/partners',
    title: 'Work as a Valet or Car Wash Partner',
    description: `Join ParkEase as a valet or car wash partner. Registration is free, you choose your own hours, and you keep ${String(PRICING.valet.keepsPercent)}% of every job you complete.`,
  },
  deleteAccount: {
    path: '/account/delete',
    title: 'Delete Your Account',
    description:
      'How to delete your ParkEase account and personal data, what we delete, what the law requires us to keep, and how long the process takes.',
  },
  legalPrivacy: {
    path: '/legal/privacy',
    title: 'Privacy Policy',
    description:
      'How ParkEase collects, uses and protects your personal data, who processes it, how long it is kept, and how to access, correct or erase it.',
  },
  legalTerms: {
    path: '/legal/terms',
    title: 'Terms of Service',
    description:
      'The terms that apply when you use ParkEase to find parking, list a space or work as a valet or car wash partner, and how disputes are handled.',
  },
  legalRefunds: {
    path: '/legal/refunds',
    title: 'Refund Policy',
    description:
      'How refunds work on ParkEase when a parking booking is cancelled by you or by the space owner, how much you get back and how it is paid.',
  },
  legalGuidelines: {
    path: '/legal/guidelines',
    title: 'Community Guidelines',
    description:
      'The standards for ParkEase listings, reviews and partner conduct that keep spaces accurate, reviews useful and every booking safe for all.',
  },
} as const satisfies Record<string, PageMeta>;

export type PageKey = keyof typeof PAGES;

/** The title as it appears in the browser tab, after the layout template. */
export function fullTitle(page: PageMeta): string {
  return page.absolute ? page.title : `${page.title} — ParkEase`;
}

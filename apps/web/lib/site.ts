/**
 * The canonical origin for metadata, the sitemap and robots.txt. Set NEXT_PUBLIC_SITE_URL when
 * the site is deployed anywhere other than parkease.in, so search engines are not pointed at a
 * domain the deployment does not serve.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://parkease.in').replace(
  /\/$/,
  '',
);
export const SITE_HOST = new URL(SITE_URL).host;
export const SITE_NAME = 'ParkEase';

/** "Pricing" becomes "Pricing — ParkEase": the layout's title template and every og:title. */
export function withSiteName(title: string): string {
  return `${title} — ${SITE_NAME}`;
}

/**
 * ParkEase is a portfolio project: the apps are not in the stores yet. Each store button links
 * only when its listing URL is configured, and otherwise says the app is coming soon, so the site
 * never sends anyone to a listing that does not exist.
 */
export const STORE_LINKS = {
  android: process.env.NEXT_PUBLIC_PLAY_STORE_URL || null,
  ios: process.env.NEXT_PUBLIC_APP_STORE_URL || null,
} as const;

/** Shown in the footer while the project is a showcase rather than a live service. */
export const PROJECT_NOTE =
  'ParkEase is a portfolio project. The apps are not in the stores yet, and no bookings or payments are taken.';

const OWNER_EMAIL = 'onkardeokate@gmail.com';

/** Every route goes to the project owner while ParkEase has no mailboxes of its own. */
export const CONTACT = {
  support: OWNER_EMAIL,
  partners: OWNER_EMAIL,
  press: OWNER_EMAIL,
  grievance: OWNER_EMAIL,
} as const;

/**
 * Who runs the project. A registered company would add its CIN and registered office here; the
 * footer, contact and legal pages show those lines only when they are set.
 */
export const COMPANY: {
  readonly legalName: string;
  readonly cin: string | null;
  readonly address: string;
  readonly grievanceOfficer: string;
} = {
  legalName: 'ParkEase, a project by Onkar Deokate',
  cin: null,
  address: 'Bengaluru, Karnataka, India',
  grievanceOfficer: 'Onkar Deokate',
};

/** The project's public profile. Add social accounts here once they exist. */
export const SOCIAL = ['https://github.com/Deonkar/parkease'];

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

/** Every navigation link, once. The header, phone menu and footer pick from this. */
const LINKS = {
  findParking: { href: '/find-parking', label: 'Find parking' },
  howItWorks: { href: '/how-it-works', label: 'How it works' },
  valetAndWash: { href: '/valet', label: 'Valet & wash' },
  valet: { href: '/valet', label: 'Valet' },
  carWash: { href: '/car-wash', label: 'Car wash' },
  pricing: { href: '/pricing', label: 'Pricing' },
  listYourSpace: { href: '/earn', label: 'List your space' },
  faq: { href: '/faq', label: 'FAQ' },
  contact: { href: '/contact', label: 'Contact' },
  about: { href: '/about', label: 'About' },
  blog: { href: '/blog', label: 'Blog' },
  workAsValet: { href: '/partners', label: 'Work as a valet' },
  runCarWash: { href: '/partners#car-wash', label: 'Run a car wash' },
  privacy: { href: '/legal/privacy', label: 'Privacy' },
  terms: { href: '/legal/terms', label: 'Terms' },
  refunds: { href: '/legal/refunds', label: 'Refunds' },
  guidelines: { href: '/legal/guidelines', label: 'Guidelines' },
  deleteAccount: { href: '/account/delete', label: 'Delete your account' },
} as const satisfies Record<string, NavLink>;

/** A link is current on its own page and on pages below it (/blog for /blog/a-post). */
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const MAIN_NAV: readonly NavLink[] = [
  LINKS.findParking,
  LINKS.valetAndWash,
  LINKS.pricing,
  LINKS.listYourSpace,
  LINKS.faq,
];

export const MOBILE_NAV: readonly NavLink[] = [
  LINKS.findParking,
  LINKS.howItWorks,
  LINKS.valet,
  LINKS.carWash,
  LINKS.pricing,
  LINKS.listYourSpace,
  LINKS.faq,
  LINKS.contact,
];

export const FOOTER_NAV: readonly {
  readonly heading: string;
  readonly links: readonly NavLink[];
}[] = [
  {
    heading: 'Drivers',
    links: [LINKS.findParking, LINKS.howItWorks, LINKS.valet, LINKS.carWash, LINKS.pricing],
  },
  {
    heading: 'Owners and partners',
    links: [LINKS.listYourSpace, LINKS.workAsValet, LINKS.runCarWash],
  },
  { heading: 'Company', links: [LINKS.about, LINKS.contact, LINKS.blog, LINKS.faq] },
  {
    heading: 'Legal',
    links: [LINKS.privacy, LINKS.terms, LINKS.refunds, LINKS.guidelines, LINKS.deleteAccount],
  },
];

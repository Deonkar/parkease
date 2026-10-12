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

export const MAIN_NAV: readonly NavLink[] = [
  { href: '/find-parking', label: 'Find parking' },
  { href: '/valet', label: 'Valet & wash' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/earn', label: 'List your space' },
  { href: '/faq', label: 'FAQ' },
];

export const MOBILE_NAV: readonly NavLink[] = [
  { href: '/find-parking', label: 'Find parking' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/valet', label: 'Valet' },
  { href: '/car-wash', label: 'Car wash' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/earn', label: 'List your space' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

export const FOOTER_NAV: readonly {
  readonly heading: string;
  readonly links: readonly NavLink[];
}[] = [
  {
    heading: 'Drivers',
    links: [
      { href: '/find-parking', label: 'Find parking' },
      { href: '/how-it-works', label: 'How it works' },
      { href: '/valet', label: 'Valet' },
      { href: '/car-wash', label: 'Car wash' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    heading: 'Owners and partners',
    links: [
      { href: '/earn', label: 'List your space' },
      { href: '/partners', label: 'Work as a valet' },
      { href: '/partners#car-wash', label: 'Run a car wash' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: '/blog', label: 'Blog' },
      { href: '/faq', label: 'FAQ' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/legal/privacy', label: 'Privacy' },
      { href: '/legal/terms', label: 'Terms' },
      { href: '/legal/refunds', label: 'Refunds' },
      { href: '/legal/guidelines', label: 'Guidelines' },
      { href: '/account/delete', label: 'Delete your account' },
    ],
  },
];

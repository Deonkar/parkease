export const SITE_URL = 'https://parkease.in';
export const SITE_NAME = 'ParkEase';

/** Android's listing is derived from the real package id in apps/mobile/app.json. */
export const STORE_LINKS = {
  android: 'https://play.google.com/store/apps/details?id=in.parkease.app',
  /** The App Store id is assigned at first submission; until then the iPhone button says so. */
  ios: process.env.NEXT_PUBLIC_APP_STORE_URL ?? null,
} as const;

/**
 * Mailboxes and company details shown in the footer, contact and legal pages.
 * Indian e-commerce and IT rules require the legal name, address and grievance officer to be
 * published. Values in brackets are pending from the founder (see the PR description).
 */
export const CONTACT = {
  support: 'support@parkease.in',
  partners: 'partners@parkease.in',
  press: 'press@parkease.in',
  grievance: 'grievance@parkease.in',
} as const;

export const COMPANY = {
  legalName: '[LEGAL ENTITY NAME] Private Limited',
  cin: '[CIN]',
  address: '[REGISTERED ADDRESS], Bengaluru [PIN]',
  grievanceOfficer: '[GRIEVANCE OFFICER NAME]',
} as const;

export const SOCIAL = [
  'https://www.instagram.com/parkease.in',
  'https://www.linkedin.com/company/parkease',
];

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

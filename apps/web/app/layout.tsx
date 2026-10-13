import { webColors } from '@parkease/tokens';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { atkinson, bigShoulders, bigShouldersStencil, rupeeDisplay, rupeeSans } from '@/app/fonts';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { JsonLd } from '@/components/ui/JsonLd';
import { organizationJsonLd } from '@/lib/jsonld';
import { PAGES } from '@/lib/pages';
import { SITE_NAME, SITE_URL, withSiteName } from '@/lib/site';
import { themeCss } from '@/lib/theme';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: PAGES.home.title,
    template: withSiteName('%s'),
  },
  description: PAGES.home.description,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    siteName: SITE_NAME,
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: webColors.midnight,
  colorScheme: 'light',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html
      lang="en-IN"
      className={`${bigShoulders.variable} ${bigShouldersStencil.variable} ${atkinson.variable} ${rupeeSans.variable} ${rupeeDisplay.variable}`}
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
        <JsonLd data={organizationJsonLd()} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-3 focus:font-bold"
        >
          Skip to content
        </a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

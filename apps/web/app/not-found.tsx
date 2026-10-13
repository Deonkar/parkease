import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHero } from '@/components/sections/PageHero';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <PageHero
      lines={['This bay doesn’t exist.']}
      lead="The page you were after has moved, or was never painted in. These ones are definitely there:"
      actions={
        <>
          <Link className="btn btn-light" href="/">
            Home
          </Link>
          <Link className="btn btn-outline-light" href="/find-parking">
            Find parking
          </Link>
          <Link className="btn btn-outline-light" href="/faq">
            FAQ
          </Link>
        </>
      }
      aside={
        <div
          aria-hidden="true"
          className="relative flex h-[300px] w-full flex-[0_1_360px] items-end justify-center overflow-hidden rounded-[28px] bg-floor"
        >
          <div className="absolute inset-y-0 left-6 w-1 bg-floor-paint" />
          <div className="absolute inset-y-0 right-6 w-1 bg-floor-paint" />
          <span className="mb-8 font-stencil text-[132px] leading-none font-extrabold text-floor-stencil">
            404
          </span>
        </div>
      }
    />
  );
}

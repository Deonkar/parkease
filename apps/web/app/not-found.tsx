import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <section aria-labelledby="page-title" className="bg-midnight text-on-midnight">
      <div className="wrap flex flex-wrap items-center gap-x-16 gap-y-12 py-24 md:py-32">
        <div className="flex flex-[1_1_520px] flex-col gap-6">
          <h1 id="page-title" className="type-page">
            <span className="rise-line">
              <span>This bay doesn’t exist.</span>
            </span>
          </h1>
          <p className="max-w-[520px] text-[19px] leading-normal text-on-midnight-muted">
            The page you were after has moved, or was never painted in. These ones are definitely
            there:
          </p>
          <div className="flex flex-wrap gap-2.5">
            <Link className="btn btn-light" href="/">
              Home
            </Link>
            <Link className="btn btn-outline-light" href="/find-parking">
              Find parking
            </Link>
            <Link className="btn btn-outline-light" href="/faq">
              FAQ
            </Link>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="relative flex h-[300px] flex-[0_1_360px] items-end justify-center overflow-hidden rounded-[28px] bg-floor"
        >
          <div className="absolute inset-y-0 left-6 w-1 bg-floor-paint" />
          <div className="absolute inset-y-0 right-6 w-1 bg-floor-paint" />
          <span className="mb-8 font-stencil text-[132px] leading-none font-extrabold text-floor-stencil">
            404
          </span>
        </div>
      </div>
    </section>
  );
}

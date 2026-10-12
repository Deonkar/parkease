import Link from 'next/link';

import { MOBILE_NAV } from '@/lib/site';

/** A native <details> menu: opens without JavaScript and is keyboard-operable for free. */
export function MobileMenu() {
  return (
    <details className="menu md:hidden">
      <summary
        aria-label="Menu"
        className="flex size-11 cursor-pointer items-center justify-center rounded-[10px] text-on-midnight shadow-[inset_0_0_0_1.5px_var(--pe-midnight-rule)]"
      >
        <svg
          className="icon-open"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        <svg
          className="icon-close"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </summary>
      <nav
        aria-label="Menu"
        className="menu-panel absolute inset-x-0 top-full flex flex-col border-b border-midnight-rule bg-midnight px-6 pt-2 pb-7 shadow-[0_24px_40px_-20px_var(--pe-shadow)]"
      >
        {MOBILE_NAV.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="border-b border-midnight-rule py-3.5 text-[19px] font-bold text-on-midnight no-underline"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </details>
  );
}

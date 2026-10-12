'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { MOBILE_NAV } from '@/lib/site';

/**
 * A native <details> menu, so it opens without JavaScript and is keyboard-operable for free.
 * The header persists across client-side navigation, so the menu closes itself when the page
 * changes, and on Escape.
 */
export function MobileMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (menu.current !== null) menu.current.open = false;
  }, [pathname]);

  return (
    <details
      ref={menu}
      className="menu md:hidden"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && menu.current?.open === true) {
          menu.current.open = false;
          menu.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label="Menu"
        className="press flex size-11 cursor-pointer items-center justify-center rounded-[10px] text-on-midnight shadow-[inset_0_0_0_1.5px_var(--pe-midnight-rule)]"
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
            aria-current={pathname === link.href ? 'page' : undefined}
            onClick={() => {
              if (menu.current !== null) menu.current.open = false;
            }}
            className={`flex min-h-12 items-center justify-between border-b border-midnight-rule text-[19px] font-bold no-underline ${pathname === link.href ? 'text-sky' : 'text-on-midnight'}`}
          >
            {link.label}
            {pathname === link.href && (
              <span className="text-sm font-bold text-on-midnight-muted">You’re here</span>
            )}
          </Link>
        ))}
      </nav>
    </details>
  );
}

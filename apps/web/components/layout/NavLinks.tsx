'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { MAIN_NAV } from '@/lib/site';

export function NavLinks() {
  const pathname = usePathname();
  return (
    <div className="hidden gap-6 text-base font-bold md:flex">
      {MAIN_NAV.map((link) => {
        const current = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? 'page' : undefined}
            className={`py-3 no-underline ${current ? 'text-sky underline decoration-2 underline-offset-8' : 'text-on-midnight'}`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}

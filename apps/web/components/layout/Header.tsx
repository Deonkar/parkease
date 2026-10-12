import Link from 'next/link';

import { MobileMenu } from '@/components/layout/MobileMenu';
import { NavLinks } from '@/components/layout/NavLinks';
import { Logo } from '@/components/ui/Logo';

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-midnight-rule bg-[var(--pe-nav-glass)] backdrop-blur-[16px] backdrop-saturate-150">
      <nav aria-label="Main" className="wrap flex items-center gap-2.5 py-3.5 md:gap-8">
        <Logo />
        <NavLinks />
        <Link
          href="/#get-the-app"
          className="btn btn-sm btn-light max-md:px-3.5 max-md:text-[15px] max-[359px]:hidden"
        >
          Get the app
        </Link>
        <MobileMenu />
      </nav>
    </header>
  );
}

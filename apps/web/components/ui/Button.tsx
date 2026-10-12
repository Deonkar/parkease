import Link from 'next/link';
import type { ReactNode } from 'react';

type Variant = 'light' | 'outline-light' | 'primary' | 'ink';

export function Button({
  href,
  children,
  variant = 'primary',
  small = false,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly variant?: Variant;
  readonly small?: boolean;
}) {
  const className = `btn btn-${variant}${small ? ' btn-sm' : ''}`;
  if (href.startsWith('http') || href.startsWith('mailto:')) {
    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  }
  return (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}

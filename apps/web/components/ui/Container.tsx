import type { ReactNode } from 'react';

export function Container({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={`wrap ${className}`}>{children}</div>;
}

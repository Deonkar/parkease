import type { ReactNode } from 'react';

export function SectionHeading({
  id,
  children,
  className = '',
}: {
  readonly id: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <h2 id={id} className={`type-section ${className}`}>
      {children}
    </h2>
  );
}

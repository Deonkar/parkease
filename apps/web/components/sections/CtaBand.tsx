import type { ReactNode } from 'react';

import { AppStoreBadges } from '@/components/sections/AppStoreBadges';

export function CtaBand({
  title,
  id,
  children,
}: {
  readonly title: string;
  readonly id?: string;
  readonly children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby="cta-title" className="bg-midnight text-on-midnight">
      <div className="wrap flex flex-wrap items-end justify-between gap-x-12 gap-y-8 py-28">
        <div className="flex flex-[1_1_560px] flex-col gap-5">
          <h2 id="cta-title" className="type-cta">
            {title}
          </h2>
          {children}
        </div>
        <AppStoreBadges />
      </div>
    </section>
  );
}

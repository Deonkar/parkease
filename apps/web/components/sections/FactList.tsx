import type { ReactNode } from 'react';

export interface Fact {
  readonly term: string;
  readonly detail: ReactNode;
}

/** A ruled list of short facts: a bold term over a line or two of detail. */
export function FactList({
  items,
  className = '',
}: {
  readonly items: readonly Fact[];
  readonly className?: string;
}) {
  return (
    <dl className={`divide-y divide-rule border-t-2 border-ink ${className}`}>
      {items.map((item) => (
        <div key={item.term} className="py-6">
          <dt className="mb-1.5 text-[19px] font-extrabold">{item.term}</dt>
          <dd className="text-[17px] leading-relaxed text-slate">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

import type { ReactNode } from 'react';

export interface Detail {
  readonly label: string;
  readonly value: ReactNode;
  /** Takes the full row on wider screens. */
  readonly wide?: boolean;
}

/** Small label over a bold value, in a grid: company and contact details. */
export function DetailList({
  items,
  className = '',
}: {
  readonly items: readonly Detail[];
  readonly className?: string;
}) {
  return (
    <dl className={`grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-10 ${className}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className={`border-t border-rule py-4.5 ${item.wide === true ? 'sm:col-span-2' : ''}`}
        >
          <dt className="text-sm text-slate">{item.label}</dt>
          <dd className="mt-1 text-lg font-bold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

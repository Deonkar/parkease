import type { ReactNode } from 'react';

/** Green is reserved for "free right now": use `free` for nothing else. */
export function Badge({
  children,
  tone = 'neutral',
}: {
  readonly children: ReactNode;
  readonly tone?: 'neutral' | 'free' | 'warn';
}) {
  const tones = {
    neutral: 'bg-mist text-ink',
    free: 'bg-available-soft text-available-ink',
    warn: 'bg-warn-soft text-warn-ink',
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

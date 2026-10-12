import type { ReactNode } from 'react';

/** The dark band every page opens with. `lines` lets a headline rise line by line. */
export function PageHero({
  lines,
  lead,
  actions,
  aside,
  before,
  home = false,
}: {
  readonly lines: readonly string[];
  readonly lead?: ReactNode;
  readonly actions?: ReactNode;
  readonly aside?: ReactNode;
  readonly before?: ReactNode;
  readonly home?: boolean;
}) {
  return (
    <section aria-labelledby="page-title" className="bg-midnight text-on-midnight">
      <div className="wrap flex flex-wrap items-end gap-x-16 gap-y-10 pt-14 pb-20 md:pt-16">
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-7">
          {before}
          <h1 id="page-title" className={home ? 'type-home' : 'type-page'}>
            {lines.map((line) => (
              <span key={line} className="rise-line">
                <span>{line}</span>
              </span>
            ))}
          </h1>
          {lead !== undefined && (
            <p className="max-w-[560px] text-[19px] leading-normal text-on-midnight-muted">
              {lead}
            </p>
          )}
          {actions !== undefined && <div className="flex flex-wrap gap-2.5">{actions}</div>}
        </div>
        {aside}
      </div>
    </section>
  );
}

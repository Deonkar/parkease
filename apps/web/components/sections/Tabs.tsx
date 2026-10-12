'use client';

import { useId, useState, type ReactNode } from 'react';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

/**
 * Two-option tabs with a sliding indicator. Every panel stays in the DOM (inactive ones are
 * hidden), so all content is crawlable and the page works before hydration.
 */
export function Tabs({
  items,
  label,
}: {
  readonly items: readonly [TabItem, TabItem];
  readonly label: string;
}) {
  const base = useId();
  const [active, setActive] = useState(0);
  const tabId = (i: number) => `${base}-tab-${String(i)}`;
  const panelId = (i: number) => `${base}-panel-${String(i)}`;

  return (
    <div className="flex flex-col gap-14">
      <div
        role="tablist"
        aria-label={label}
        className="relative flex w-full max-w-[440px] self-start rounded-2xl bg-midnight-raised p-1.5 shadow-[inset_0_0_0_1px_var(--pe-midnight-rule)]"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            const next = active === 0 ? 1 : 0;
            setActive(next);
            document.getElementById(tabId(next))?.focus();
          }
        }}
      >
        <span
          aria-hidden="true"
          className="tab-indicator absolute inset-y-1.5 left-1.5 w-[calc(50%-6px)] rounded-[11px] bg-porcelain"
          style={{ transform: `translateX(${active === 0 ? '0%' : '100%'})` }}
        />
        {items.map((item, i) => (
          <button
            key={item.id}
            id={tabId(i)}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-controls={panelId(i)}
            tabIndex={active === i ? 0 : -1}
            onClick={() => {
              setActive(i);
            }}
            className={`relative h-[52px] flex-1 cursor-pointer px-2 text-[15px] leading-tight font-bold transition-colors sm:text-[17px] ${active === i ? 'text-midnight' : 'text-on-midnight-muted'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid">
        {items.map((item, i) => (
          <div
            key={item.id}
            id={panelId(i)}
            role="tabpanel"
            aria-labelledby={tabId(i)}
            data-active={active === i}
            hidden={active !== i}
            className="panel"
          >
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}

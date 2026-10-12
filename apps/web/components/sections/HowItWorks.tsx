'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { withRupee } from '@/lib/rupee';

/** Amounts the story quotes, passed in from lib/pricing so the client bundle skips contracts. */
export interface StoryAmounts {
  readonly ownerCancelGoodwill: string;
  readonly valetFee: string;
  readonly exampleHours: number;
  readonly exampleTotal: string;
}

const steps = (a: StoryAmounts) => [
  {
    title: 'Drop a pin where you’re going',
    body: 'Pick car or two-wheeler. Green on the map means a slot is free right now, and nothing else on ParkEase is green.',
  },
  {
    title: 'Book the hours you need',
    body: 'Every rupee is shown before you pay. Add a valet or a wash to the booking if you want one.',
  },
  {
    title: 'Show your pass at the gate',
    body: `The owner scans it and you’re in. If they cancel on you, you get everything back plus ${a.ownerCancelGoodwill} from us.`,
  },
];

/**
 * The home page story: the app screen follows the step you're reading. Scrolling a step into
 * the middle of the viewport activates it; each step is also a button, so it works without
 * scrolling and from the keyboard.
 */
export function HowItWorks({
  qrPath,
  amounts,
  map,
  mapAttribution,
}: {
  readonly qrPath: string;
  readonly amounts: StoryAmounts;
  /** Rendered on the server and passed in, so the map geometry never ships as JavaScript. */
  readonly map: ReactNode;
  readonly mapAttribution: string;
}) {
  const STEPS = steps(amounts);
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    for (const el of stepRefs.current) if (el) observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-wrap items-start gap-x-22 gap-y-10">
      <div className="story-sticky mx-auto w-full max-w-[360px] flex-[0_1_360px]">
        <div
          aria-live="polite"
          className="relative h-[640px] w-full rounded-[44px] bg-midnight p-2.5 shadow-[0_40px_80px_-30px_var(--pe-shadow)]"
        >
          <div className="relative size-full overflow-hidden rounded-[35px] bg-porcelain text-ink">
            <div className="screen" data-active={active === 0} aria-hidden={active !== 0}>
              <div className="absolute inset-0">{map}</div>
              <div className="absolute inset-x-3.5 top-4 flex flex-col gap-2">
                <div className="flex h-12 items-center gap-2.5 rounded-[14px] bg-paper px-3.5 shadow-[0_2px_10px_var(--pe-shadow-soft)]">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                  <span className="text-[15px] font-bold">100 Feet Road, Indiranagar</span>
                </div>
                <div className="flex gap-1.5 text-[13px] font-bold">
                  <span className="rounded-full bg-ink px-3 py-1.5 text-paper">Car</span>
                  <span className="rounded-full bg-paper px-3 py-1.5">Two-wheeler</span>
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-paper px-[18px] pt-3 pb-5 shadow-[0_-4px_16px_var(--pe-shadow-soft)]">
                <div className="mx-auto mb-3.5 h-1 w-10 rounded-full bg-rule" />
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-lg font-extrabold">5 spaces free nearby</span>
                  <span className="text-[13px] text-slate">Closest first</span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate">{mapAttribution}</p>
              </div>
            </div>

            <div className="screen" data-active={active === 1} aria-hidden={active !== 1}>
              <div className="flex h-[168px] items-center justify-center bg-gradient-to-br from-midnight-raised to-floor px-3 text-center text-[13px] font-bold text-on-midnight-muted">
                [Owner’s listing photo]
              </div>
              <div className="flex flex-col gap-3.5 p-[18px]">
                <div>
                  <p className="text-lg font-extrabold">Covered basement, 12th Main</p>
                  <p className="text-sm text-slate">Indiranagar</p>
                </div>
                <div className="flex items-center gap-2 text-[15px] font-bold">
                  <span className="rounded-[10px] border-[1.5px] border-rule bg-paper px-3 py-2">
                    Sat 6:00pm
                  </span>
                  <span className="text-slate">to</span>
                  <span className="rounded-[10px] border-[1.5px] border-rule bg-paper px-3 py-2">
                    8:00pm
                  </span>
                </div>
                <div className="rounded-[14px] bg-paper px-3.5">
                  {[
                    ['Add a valet', amounts.valetFee],
                    ['Add a wash', 'From the partner’s menu'],
                  ].map(([title, sub]) => (
                    <div
                      key={title}
                      className="flex items-center justify-between border-b border-rule py-3 last:border-b-0"
                    >
                      <div>
                        <p className="text-[15px] font-bold">{title}</p>
                        <p className="text-[13px] text-slate">{sub}</p>
                      </div>
                      <span className="relative h-6 w-10 rounded-full bg-rule">
                        <span className="absolute top-[3px] left-[3px] size-[18px] rounded-full bg-paper" />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-paper px-[18px] pt-3.5 pb-5 shadow-[0_-4px_16px_var(--pe-shadow-soft)]">
                <div>
                  <p className="text-[13px] text-slate">{amounts.exampleHours} hrs, incl. GST</p>
                  <p className="type-figure text-[30px]">{withRupee(amounts.exampleTotal)}</p>
                </div>
                <span className="inline-flex h-[46px] items-center rounded-xl bg-primary px-5 font-bold text-on-primary">
                  Pay and book
                </span>
              </div>
            </div>

            <div className="screen" data-active={active === 2} aria-hidden={active !== 2}>
              <div className="flex h-full flex-col items-center gap-3 bg-midnight px-[22px] pt-[34px] pb-[22px] text-on-midnight">
                <span className="text-[15px] font-bold text-on-midnight-muted">
                  Show this at the gate
                </span>
                <span className="type-figure text-5xl">Bay 16, B2</span>
                <div className="mt-2.5 rounded-[20px] bg-paper p-[18px] shadow-[0_0_40px_var(--pe-free-glow)]">
                  <svg
                    role="img"
                    aria-label="Booking pass code"
                    width="196"
                    height="196"
                    viewBox="-1 -1 23 23"
                  >
                    <path
                      d={qrPath}
                      fill="currentColor"
                      className="text-midnight"
                      fillRule="evenodd"
                    />
                  </svg>
                </div>
                <span className="text-[15px] text-on-midnight-muted">Until 8:00pm today</span>
                <span className="mt-auto flex h-12 w-full items-center justify-center rounded-xl bg-porcelain font-bold text-midnight">
                  Directions to the gate
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative min-w-0 flex-[1_1_420px] pl-[34px]">
        <div
          aria-hidden="true"
          className="absolute top-2 bottom-2 left-2 w-[3px] rounded-full bg-rule"
        >
          <div
            className="rail-fill size-full rounded-full bg-primary"
            style={{ transform: `scaleY(${String((active + 1) / STEPS.length)})` }}
          />
        </div>
        <ol className="flex flex-col">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              data-step={i}
              className="story-step pt-2 pb-10"
            >
              <button
                type="button"
                aria-pressed={active === i}
                onClick={() => {
                  setActive(i);
                }}
                className={`flex cursor-pointer flex-col gap-3 text-left transition-colors duration-200 ${active === i ? 'text-ink' : 'text-slate'}`}
              >
                <span className="font-display text-[clamp(28px,2.8vw,38px)] leading-[0.95] font-black">
                  {step.title}
                </span>
                <span className="max-w-[440px] text-lg leading-relaxed text-slate">
                  {step.body}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

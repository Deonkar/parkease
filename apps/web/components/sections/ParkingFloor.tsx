import { webColors } from '@parkease/tokens';

const BAYS = 15;
const FREE_INDEX = 7;
const FIRST_NUMBER = 9;

function Car({ color }: { readonly color: string }) {
  return (
    <svg
      width="78"
      height="160"
      viewBox="0 0 78 160"
      fill="none"
      className="drop-shadow-[0_12px_14px_rgba(0,0,0,0.45)]"
    >
      <rect x="1" y="1" width="76" height="158" rx="22" fill={color} />
      <rect x="10" y="44" width="58" height="66" rx="12" fill={webColors.paper} opacity="0.045" />
      <rect
        x="1.5"
        y="1.5"
        width="75"
        height="157"
        rx="21.5"
        stroke={webColors.paper}
        strokeOpacity="0.08"
      />
    </svg>
  );
}

function LeavingCar() {
  return (
    <svg
      className="floor-leaving absolute top-6 left-6 overflow-visible drop-shadow-[0_12px_14px_rgba(0,0,0,0.45)]"
      width="78"
      height="160"
      viewBox="0 0 78 160"
      fill="none"
    >
      <defs>
        <filter id="tail-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <rect x="1" y="1" width="76" height="158" rx="22" fill={webColors.carLeaving} />
      <rect x="10" y="44" width="58" height="66" rx="12" fill={webColors.paper} opacity="0.05" />
      <rect
        x="8"
        y="0"
        width="20"
        height="5"
        rx="2.5"
        fill={webColors.tailLight}
        filter="url(#tail-glow)"
      />
      <rect
        x="50"
        y="0"
        width="20"
        height="5"
        rx="2.5"
        fill={webColors.tailLight}
        filter="url(#tail-glow)"
      />
      <rect x="10" y="1" width="16" height="3" rx="1.5" fill={webColors.tailLightCore} />
      <rect x="52" y="1" width="16" height="3" rx="1.5" fill={webColors.tailLightCore} />
    </svg>
  );
}

/**
 * The home page's one orchestrated moment: a car backs out of bay 16, the bay is painted free,
 * and a booking card for it lands. Pure CSS, plays once, and shows the end state under
 * reduced motion.
 */
export function ParkingFloor() {
  const bays = Array.from({ length: BAYS }, (_, i) => ({
    number: String(FIRST_NUMBER + i).padStart(2, '0'),
    free: i === FREE_INDEX,
    color: webColors.carShades[i % webColors.carShades.length] ?? webColors.carLeaving,
  }));

  return (
    <div
      role="img"
      aria-label="A row of parking bays at night. A car backs out of bay 16, the bay lights up as free, and a booking card for it appears."
      className="relative border-t border-midnight-rule bg-floor"
    >
      <div aria-hidden="true" className="floor-drift">
        <div className="flex h-20 items-center overflow-hidden">
          <div className="h-1 w-full bg-[repeating-linear-gradient(90deg,var(--pe-floor-paint)_0_44px,transparent_44px_92px)]" />
        </div>
        <div className="flex justify-center overflow-hidden">
          {bays.map((bay) => (
            <div
              key={bay.number}
              className="relative flex h-[232px] shrink-0 grow-0 basis-[136px] justify-center border-l-4 border-floor-paint pt-6"
            >
              {bay.free ? (
                <>
                  <div className="floor-glow pointer-events-none absolute -inset-x-10 inset-y-2.5 bg-[radial-gradient(closest-side,var(--pe-free-glow),transparent)]" />
                  <div className="floor-paint absolute inset-x-2.5 top-[58px] flex h-[92px] flex-col items-center justify-center rounded-[3px] bg-[var(--pe-free-lit-fill)] text-free-lit shadow-[inset_0_0_0_3px_var(--pe-free-lit)]">
                    <span className="font-stencil text-[46px] leading-[0.9] font-extrabold">
                      FREE
                    </span>
                    <span className="font-display text-[17px] font-extrabold">right now</span>
                  </div>
                  <LeavingCar />
                </>
              ) : (
                <Car color={bay.color} />
              )}
              <span className="absolute inset-x-0 bottom-2 text-center font-stencil text-[34px] font-extrabold text-floor-stencil">
                {bay.number}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="kerb" />
      <div className="floor-card absolute top-[calc(100%-30px)] left-1/2 z-[2] w-[min(372px,calc(100%-32px))] -translate-x-1/2">
        <div className="flex items-center justify-between gap-3.5 rounded-2xl bg-paper p-[18px] text-ink shadow-[0_2px_4px_rgba(8,17,30,0.08),0_24px_48px_-14px_var(--pe-shadow)]">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[17px] font-extrabold">Bay 16, 12th Main</span>
            <span className="inline-flex items-center gap-2 text-sm font-bold text-available-ink">
              <span className="size-2 rounded-full bg-available" />
              Free now, 4 min walk
            </span>
          </div>
          <span className="inline-flex h-11 shrink-0 items-center rounded-[10px] bg-primary px-4 font-bold text-on-primary">
            Book ₹40/hr
          </span>
        </div>
      </div>
    </div>
  );
}

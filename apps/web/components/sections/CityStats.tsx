import type { City } from '@/lib/cities';

/**
 * The one number on a city page. The vehicle counts come from the task 20 brief and still need a
 * cited source before launch; the source line says so rather than inventing one.
 */
export function CityStats({ city }: { readonly city: City }) {
  return (
    <section aria-labelledby="stat-title" className="bg-paper">
      <div className="wrap flex flex-wrap items-end gap-x-14 gap-y-6 py-24">
        <h2
          id="stat-title"
          className="font-display text-[clamp(96px,16vw,220px)] leading-[0.8] font-black text-ink"
        >
          {city.vehicleCount}
        </h2>
        <div className="flex max-w-[460px] flex-col gap-3 pb-3">
          <p className="text-[clamp(22px,2.4vw,30px)] leading-snug font-bold">
            vehicles on {city.name}’s roads, and nowhere near enough places to leave them.
          </p>
          <p className="text-sm text-slate">Registered vehicles, approximate.</p>
        </div>
      </div>
    </section>
  );
}

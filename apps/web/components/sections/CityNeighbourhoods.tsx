import type { City } from '@/lib/cities';

/** Neighbourhoods painted as a row of bays on the basement floor, bay numbers stencilled. */
export function CityNeighbourhoods({ city }: { readonly city: City }) {
  return (
    <section aria-labelledby="hoods-title" className="bg-floor text-on-midnight">
      <div className="wrap flex flex-col gap-3 pt-24 pb-12">
        <h2 id="hoods-title" className="type-section">
          Where people park
        </h2>
        <p className="max-w-[520px] text-lg text-on-midnight-muted">
          Open the app near any of these and you’ll see the spaces free around you.
        </p>
      </div>
      <div className="overflow-x-auto pb-20">
        <ul className="wrap flex min-w-max">
          {city.neighbourhoods.map((name, i) => (
            <li
              key={name}
              className="relative flex h-[220px] w-[200px] flex-col justify-between border-l-4 border-floor-paint px-5 pt-6 pb-4 last:border-r-4"
            >
              <span className="text-[22px] leading-tight font-extrabold">{name}</span>
              <span
                aria-hidden="true"
                className="font-stencil text-[44px] leading-none font-extrabold text-floor-stencil"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div aria-hidden="true" className="kerb" />
    </section>
  );
}

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
      <ul className="wrap grid grid-cols-2 pb-20 sm:grid-cols-3 md:flex">
        {city.neighbourhoods.map((name, i) => (
          <li
            key={name}
            className="flex h-[168px] flex-col justify-between border-x-2 border-floor-paint px-4 pt-6 pb-4 md:px-5 md:h-[220px] md:w-[200px]"
          >
            <span className="text-[19px] leading-tight font-extrabold md:text-[22px]">{name}</span>
            <span
              aria-hidden="true"
              className="font-stencil text-[44px] leading-none font-extrabold text-floor-stencil"
            >
              {String(i + 1).padStart(2, '0')}
            </span>
          </li>
        ))}
      </ul>
      <div aria-hidden="true" className="kerb" />
    </section>
  );
}

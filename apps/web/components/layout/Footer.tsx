import Link from 'next/link';

import { LAUNCHED_CITIES } from '@/lib/cities';
import { COMPANY, CONTACT, FOOTER_NAV, PROJECT_NOTE } from '@/lib/site';

export function Footer() {
  return (
    <footer className="bg-midnight text-[15px] text-on-midnight-muted">
      <div aria-hidden="true" className="kerb" />
      <div className="wrap grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-x-8 gap-y-9 pt-14 pb-10">
        <div className="flex min-w-0 flex-col gap-3 sm:col-span-2">
          <p className="font-display text-[27px] font-extrabold text-on-midnight">ParkEase</p>
          <p className="leading-relaxed">
            {COMPANY.legalName}
            {COMPANY.cin !== null && (
              <>
                <br />
                CIN {COMPANY.cin}
              </>
            )}
            <br />
            {COMPANY.address}
          </p>
          <p className="leading-relaxed">
            Grievance officer: {COMPANY.grievanceOfficer},{' '}
            <a className="text-on-midnight underline" href={`mailto:${CONTACT.grievance}`}>
              {CONTACT.grievance}
            </a>
          </p>
        </div>
        {FOOTER_NAV.map((group) => (
          <nav key={group.heading} aria-label={group.heading}>
            <h2 className="mb-2.5 text-[15px] font-extrabold text-on-midnight">{group.heading}</h2>
            {group.links.map((link) => (
              <Link
                key={link.href + link.label}
                href={link.href}
                className="block py-1.5 text-on-midnight-muted no-underline hover:text-on-midnight"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="wrap flex flex-wrap justify-between gap-x-6 gap-y-3 border-t border-midnight-rule pt-5 pb-8">
        <span>© {new Date().getFullYear()} ParkEase</span>
        <span className="basis-full text-sm sm:order-last">{PROJECT_NOTE}</span>
        <span className="flex flex-wrap gap-x-5 gap-y-1.5">
          Parking in
          {LAUNCHED_CITIES.map((city) => (
            <Link
              key={city.slug}
              href={`/${city.slug}`}
              className="font-bold text-on-midnight no-underline"
            >
              {city.name}
            </Link>
          ))}
        </span>
      </div>
    </footer>
  );
}

import type { Metadata } from 'next';

import { DetailList } from '@/components/sections/DetailList';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';
import { COMPANY, CONTACT } from '@/lib/site';

export const metadata: Metadata = pageMetadata(PAGES.contact);

const ROUTES = [
  {
    who: 'Drivers',
    about: 'Bookings, refunds, a space that wasn’t as shown',
    email: CONTACT.support,
  },
  {
    who: 'Owners and partners',
    about: 'Listings, payouts, valet and wash jobs',
    email: CONTACT.partners,
  },
  {
    who: 'Press and business',
    about: 'Stories, partnerships, buildings with many bays',
    email: CONTACT.press,
  },
] as const;

export default function ContactPage() {
  return (
    <>
      <PageHero
        lines={['Contact']}
        lead="Got a booking? The fastest help is in the app, under the booking itself. For everything else, write to the right team below."
      />
      <section aria-labelledby="routes-title">
        <div className="wrap flex flex-col gap-10 py-24">
          <SectionHeading id="routes-title">Who to write to</SectionHeading>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-10">
            {ROUTES.map((route) => (
              <li key={route.who} className="flex flex-col gap-1.5 border-t-2 border-ink py-6">
                <span className="text-[19px] font-extrabold">{route.who}</span>
                <span className="text-slate">{route.about}</span>
                <a className="text-link text-[17px]" href={`mailto:${route.email}`}>
                  {route.email}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section aria-labelledby="grievance-title" className="bg-paper">
        <div className="wrap flex flex-wrap gap-x-22 gap-y-10 py-28">
          <div className="flex max-w-[420px] flex-[1_1_320px] flex-col gap-4">
            <SectionHeading id="grievance-title">Grievance officer</SectionHeading>
            <p className="text-[17px] leading-relaxed text-slate">
              If support hasn’t resolved a complaint, escalate it here. We acknowledge complaints
              within 24 hours and resolve them within 15 days.
            </p>
          </div>
          <DetailList
            className="flex-[1_1_520px]"
            items={[
              { label: 'Name', value: COMPANY.grievanceOfficer },
              {
                label: 'Email',
                value: (
                  <a className="text-link" href={`mailto:${CONTACT.grievance}`}>
                    {CONTACT.grievance}
                  </a>
                ),
              },
              { label: 'Based in', value: `${COMPANY.legalName}, ${COMPANY.address}`, wide: true },
            ]}
          />
        </div>
      </section>
    </>
  );
}

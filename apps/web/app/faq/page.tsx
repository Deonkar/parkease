import type { Metadata } from 'next';

import { CtaBand } from '@/components/sections/CtaBand';
import { FaqAccordion } from '@/components/sections/FaqAccordion';
import { PageHero } from '@/components/sections/PageHero';
import { RefundRules } from '@/components/sections/RefundRules';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { JsonLd } from '@/components/ui/JsonLd';
import { ALL_FAQ, DRIVER_FAQ, OWNER_FAQ } from '@/lib/faq';
import { faqPageJsonLd } from '@/lib/jsonld';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';
import { CONTACT } from '@/lib/site';

export const metadata: Metadata = pageMetadata(PAGES.faq);

export default function FaqPage() {
  return (
    <>
      <JsonLd data={faqPageJsonLd(ALL_FAQ)} />
      <PageHero
        lines={['Questions, answered']}
        lead={
          <>
            Can’t find it here? Write to{' '}
            <a className="text-sky underline" href={`mailto:${CONTACT.support}`}>
              {CONTACT.support}
            </a>
            , or open the booking in the app for help with a specific one.
          </>
        }
      />
      <section aria-labelledby="drivers" className="pt-20">
        <div className="wrap max-w-[920px]">
          <h2 id="drivers" className="type-section mb-6">
            For drivers
          </h2>
          <FaqAccordion items={DRIVER_FAQ} />
        </div>
      </section>
      <section aria-labelledby="owners" className="pt-20 pb-28">
        <div className="wrap max-w-[920px]">
          <h2 id="owners" className="type-section mb-6">
            For space owners
          </h2>
          <FaqAccordion items={OWNER_FAQ} />
        </div>
      </section>
      <section aria-labelledby="refunds-title" className="bg-paper">
        <div className="wrap flex flex-wrap gap-x-22 gap-y-10 py-28">
          <div className="flex max-w-[420px] flex-[1_1_320px] flex-col gap-4">
            <SectionHeading id="refunds-title">If plans change</SectionHeading>
            <p className="text-[17px] text-slate">The same rules for every booking.</p>
          </div>
          <div className="flex-[1_1_560px]">
            <RefundRules />
          </div>
        </div>
      </section>
      <CtaBand title="Still have a question? Ask in the app." />
    </>
  );
}

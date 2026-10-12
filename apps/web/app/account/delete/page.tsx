import type { Metadata } from 'next';

import { FactList } from '@/components/sections/FactList';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';
import { CONTACT } from '@/lib/site';

export const metadata: Metadata = pageMetadata(PAGES.deleteAccount);

const SUBJECT = encodeURIComponent('Delete my ParkEase account');
const BODY = encodeURIComponent(
  'Please delete my ParkEase account and personal data.\n\nMobile number on the account: \n\nI understand bookings still to come will be cancelled under the refund policy.',
);

/**
 * Google Play requires a web page where people can ask for their account and data to be deleted
 * without reinstalling the app. Until the API has a deletion endpoint, requests go to support,
 * who verify the number by OTP before acting.
 */
export default function DeleteAccountPage() {
  return (
    <>
      <PageHero
        lines={['Delete your account']}
        lead="You can ask for your ParkEase account and personal data to be deleted here, without reinstalling the app."
      />
      <section aria-labelledby="how-title">
        <div className="wrap flex flex-wrap gap-x-22 gap-y-12 py-24">
          <div className="flex max-w-[600px] flex-[1_1_520px] flex-col gap-6">
            <SectionHeading id="how-title">How to ask</SectionHeading>
            <ol className="flex flex-col gap-4 text-[17px] leading-relaxed">
              <li>
                <strong>1. Email us from any address</strong> with the mobile number you sign in
                with.
              </li>
              <li>
                <strong>2. We check it’s you</strong> by sending a one-time code to that number.
              </li>
              <li>
                <strong>3. We delete the account</strong> and text you when it’s done.
              </li>
            </ol>
            <a
              className="btn btn-primary self-start"
              href={`mailto:${CONTACT.support}?subject=${SUBJECT}&body=${BODY}`}
            >
              Email a deletion request
            </a>
            <p className="text-sm text-slate">
              Or write to {CONTACT.support} with the subject “Delete my ParkEase account”.
            </p>
          </div>
          <FactList
            className="flex-[1_1_360px]"
            items={[
              {
                term: 'What we delete',
                detail: 'Your name, mobile number, vehicles, photos, listings and reviews.',
              },
              {
                term: 'What we have to keep',
                detail:
                  'Booking and payment records, for as long as tax and accounting law requires.',
              },
              {
                term: 'Bookings still to come',
                detail: 'They are cancelled under the refund policy before the account is deleted.',
              },
            ]}
          />
        </div>
      </section>
    </>
  );
}

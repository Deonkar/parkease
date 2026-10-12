import type { Metadata } from 'next';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.legalTerms);

export default function TermsPage() {
  return <LegalDocument doc="terms" />;
}

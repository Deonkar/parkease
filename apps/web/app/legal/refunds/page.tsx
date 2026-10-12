import type { Metadata } from 'next';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.legalRefunds);

export default function RefundsPage() {
  return <LegalDocument doc="refunds" />;
}

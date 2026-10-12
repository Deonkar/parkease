import type { Metadata } from 'next';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.legalGuidelines);

export default function GuidelinesPage() {
  return <LegalDocument doc="guidelines" />;
}

import type { Metadata } from 'next';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.legalPrivacy);

export default function PrivacyPage() {
  return <LegalDocument doc="privacy" />;
}

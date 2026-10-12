import type { Metadata } from 'next';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { LEGAL_DOCS, legalDoc } from '@/lib/legal';
import type { LegalDoc } from '@/lib/mdx';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';

interface LegalParams {
  readonly doc: LegalDoc;
}

/** /legal/privacy, /legal/terms, /legal/refunds and /legal/guidelines; anything else 404s. */
export function generateStaticParams(): LegalParams[] {
  return LEGAL_DOCS.map((d) => ({ doc: d.doc }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<LegalParams>;
}): Promise<Metadata> {
  return pageMetadata(PAGES[legalDoc((await params).doc).page]);
}

export default async function LegalPage({ params }: { readonly params: Promise<LegalParams> }) {
  return <LegalDocument doc={(await params).doc} />;
}

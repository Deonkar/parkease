import type { LegalDoc } from '@/lib/mdx';
import type { PageKey } from '@/lib/pages';

/**
 * The four legal documents. `sections` is the table of contents and must match the `##`
 * headings in content/legal/<doc>.mdx; test/legal.spec.ts holds the two together.
 */
export interface LegalDocMeta {
  readonly doc: LegalDoc;
  readonly page: PageKey;
  readonly tab: string;
  readonly sections: readonly string[];
}

/** Drafts are published so the stores and Razorpay can reach them; counsel signs off before launch. */
export const LEGAL_STATUS: { readonly draft: boolean; readonly updated: string } = {
  draft: true,
  updated: '2026-10-07',
};

export const LEGAL_DOCS = [
  {
    doc: 'privacy',
    page: 'legalPrivacy',
    tab: 'Privacy',
    sections: [
      'What we collect',
      'Why we use it',
      'Who else handles it',
      'How long we keep it',
      'Your rights',
      'If something goes wrong',
      'Children',
      'Changes to this policy',
      'Grievance officer',
    ],
  },
  {
    doc: 'terms',
    page: 'legalTerms',
    tab: 'Terms',
    sections: [
      'Using ParkEase',
      'If you are parking',
      'If you list a space',
      'Valet and car wash partners',
      'Payments and fees',
      'What we are and are not responsible for',
      'Disputes',
      'Ending your account',
      'Changes to these terms',
    ],
  },
  {
    doc: 'refunds',
    page: 'legalRefunds',
    tab: 'Refunds',
    sections: [
      'When you cancel',
      'When the owner cancels',
      'Valet call-outs',
      'How refunds are paid',
      'Questions',
    ],
  },
  {
    doc: 'guidelines',
    page: 'legalGuidelines',
    tab: 'Guidelines',
    sections: [
      'Listings',
      'Reviews',
      'Valets and car wash partners',
      'Drivers',
      'Reporting a problem',
    ],
  },
] as const satisfies readonly LegalDocMeta[];

export function legalDoc(doc: LegalDoc): LegalDocMeta {
  const meta = LEGAL_DOCS.find((d) => d.doc === doc);
  if (meta === undefined) throw new Error(`Unknown legal document: ${doc}`);
  return meta;
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LEGAL_DOCS } from '@/lib/legal';
import { PAGES } from '@/lib/pages';

const read = (doc: string) =>
  readFileSync(join(__dirname, '..', 'content', 'legal', `${doc}.mdx`), 'utf8');

describe('legal documents', () => {
  it.each(LEGAL_DOCS)('$doc: table of contents matches its headings', ({ doc, sections }) => {
    const headings = [...read(doc).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(sections);
  });

  it.each(LEGAL_DOCS)('$doc: page lives under /legal', ({ doc, page }) => {
    expect(PAGES[page].path).toBe(`/legal/${doc}`);
  });

  it.each(LEGAL_DOCS)('$doc: has no unfinished draft markers', ({ doc }) => {
    expect(read(doc)).not.toMatch(/\[DRAFT|\[X\]|\[[A-Z ]+\]/);
  });

  it('the refund policy quotes the contracts constants, not typed numbers', () => {
    const refunds = read('refunds');
    expect(refunds).toContain('{PRICING.refunds.processingFee}');
    expect(refunds).toContain('{PRICING.refunds.ownerCancelGoodwill}');
    expect(refunds).not.toMatch(/₹\d/);
  });

  it('the privacy policy names every processor and the grievance officer', () => {
    const privacy = read('privacy');
    for (const name of ['Razorpay', 'Firebase', 'Cloudinary', 'Sentry', 'Upstash']) {
      expect(privacy).toContain(name);
    }
    expect(privacy).toContain('Grievance officer');
    expect(privacy).toContain('Digital Personal Data Protection Act');
  });
});

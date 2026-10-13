import { describe, expect, it } from 'vitest';

import { ALL_FAQ } from '@/lib/faq';
import {
  faqPageJsonLd,
  organizationJsonLd,
  serializeJsonLd,
  softwareApplicationJsonLd,
} from '@/lib/jsonld';

describe('JSON-LD', () => {
  it('describes the Organization with logo and social profiles', () => {
    const org = organizationJsonLd();
    expect(org['@type']).toBe('Organization');
    expect(org.url).toBe('https://parkease.in');
    expect(org.logo).toBe('https://parkease.in/logo.png');
  });

  it('describes the app as a free SoftwareApplication', () => {
    const app = softwareApplicationJsonLd();
    expect(app['@type']).toBe('SoftwareApplication');
    expect(app.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'INR' });
  });

  it('generates FAQPage from the same data the page renders', () => {
    const faq = faqPageJsonLd(ALL_FAQ);
    expect(faq.mainEntity.map((q) => q.name)).toEqual(ALL_FAQ.map((f) => f.question));
    expect(faq.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(ALL_FAQ.map((f) => f.answer));
  });

  it('never contains aggregateRating or Review', () => {
    const all = serializeJsonLd([
      organizationJsonLd(),
      softwareApplicationJsonLd(),
      faqPageJsonLd(ALL_FAQ),
    ]);
    expect(all).not.toMatch(/aggregateRating|"Review"/);
  });

  it('escapes < so a value cannot close the script tag', () => {
    expect(serializeJsonLd({ a: '</script>' })).not.toContain('</script>');
  });
});

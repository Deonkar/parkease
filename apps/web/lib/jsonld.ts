import type { BlogPost } from '@/lib/blog';
import type { FaqItem } from '@/lib/faq';
import { SITE_NAME, SITE_URL, SOCIAL } from '@/lib/site';

/**
 * Structured data (task 20 §20.8). No `aggregateRating` and no `Review` until real ratings exist
 * in the store consoles: fabricated review markup costs rich results sitewide (seo.md §2.3).
 */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    sameAs: SOCIAL,
  };
}

export function softwareApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    operatingSystem: 'Android, iOS',
    applicationCategory: 'TravelApplication',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
    description:
      'Find and book parking spaces across India. List your space and earn passive income.',
  };
}

/** Generated from the same FAQ data the page renders, never hand-typed. */
export function faqPageJsonLd(items: readonly FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function blogPostingJsonLd(post: BlogPost) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.published,
    url: `${SITE_URL}/blog/${post.slug}`,
    inLanguage: 'en-IN',
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@type': 'Organization', name: SITE_NAME, logo: `${SITE_URL}/logo.png` },
  };
}

/** `</script>` inside a string would end the tag early; escaping `<` makes that impossible. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

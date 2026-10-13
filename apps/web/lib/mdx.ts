import type { MDXContent } from 'mdx/types';

import type { BlogSlug } from '@/lib/blog';

/**
 * MDX bodies, compiled by @next/mdx at build time. Each entry is a lazy import so a page only
 * pulls in the document it renders; the explicit map keeps every slug type-checked.
 */
type Loader = () => Promise<{ default: MDXContent }>;

export const BLOG_CONTENT: Record<BlogSlug, Loader> = {
  'first-basement-booking': () => import('@/content/blog/first-basement-booking.mdx'),
  'car-or-two-wheeler': () => import('@/content/blog/car-or-two-wheeler.mdx'),
  'what-the-commission-pays-for': () => import('@/content/blog/what-the-commission-pays-for.mdx'),
};

export const LEGAL_CONTENT = {
  privacy: () => import('@/content/legal/privacy.mdx'),
  terms: () => import('@/content/legal/terms.mdx'),
  refunds: () => import('@/content/legal/refunds.mdx'),
  guidelines: () => import('@/content/legal/guidelines.mdx'),
} as const satisfies Record<string, Loader>;

export type LegalDoc = keyof typeof LEGAL_CONTENT;

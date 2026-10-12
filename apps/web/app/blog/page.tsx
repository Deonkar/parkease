import type { Metadata } from 'next';
import Link from 'next/link';

import { PostRow } from '@/components/blog/PostRow';
import { PageHero } from '@/components/sections/PageHero';
import { SectionHeading } from '@/components/sections/SectionHeading';
import { BLOG_POSTS, formatPostDate } from '@/lib/blog';
import { PAGES } from '@/lib/pages';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(PAGES.blog);

export default function BlogPage() {
  const [featured, ...rest] = BLOG_POSTS;

  return (
    <>
      <PageHero
        lines={['Notes from', 'the kerb']}
        lead="Guides for drivers and owners, and what we’re learning about parking in Indian cities."
      />
      <section aria-label="Featured post" className="bg-paper">
        <div className="wrap py-20">
          <Link
            href={`/blog/${featured.slug}`}
            className="link-row grid overflow-hidden rounded-[28px] bg-porcelain shadow-[inset_0_0_0_1px_var(--pe-rule)] md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
          >
            <div aria-hidden="true" className="relative min-h-[240px] bg-floor">
              <div className="absolute inset-y-0 left-[18%] w-1 bg-floor-paint" />
              <div className="absolute inset-y-0 left-[58%] w-1 bg-floor-paint" />
              <span className="absolute bottom-6 left-[24%] font-stencil text-[88px] leading-none font-extrabold text-floor-stencil">
                B2
              </span>
            </div>
            <div className="flex flex-col gap-4 p-8 md:p-12">
              <span className="eyebrow">{featured.category}</span>
              <h2 className="link-row-title type-card">{featured.title}</h2>
              <p className="text-lg leading-relaxed text-slate">{featured.description}</p>
              <span className="text-[15px] text-slate">
                <time dateTime={featured.published}>{formatPostDate(featured.published)}</time>,{' '}
                {featured.minutes} min read
              </span>
            </div>
          </Link>
        </div>
      </section>
      <section aria-labelledby="all-title">
        <div className="wrap flex flex-col gap-8 py-24">
          <SectionHeading id="all-title">More posts</SectionHeading>
          <ul className="border-b border-rule">
            {rest.map((post) => (
              <li key={post.slug}>
                <PostRow post={post} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

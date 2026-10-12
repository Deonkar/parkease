import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CopyLinkButton } from '@/components/blog/CopyLinkButton';
import { PostRow } from '@/components/blog/PostRow';
import { JsonLd } from '@/components/ui/JsonLd';
import { BLOG_POSTS, findPost, formatPostDate, type BlogSlug } from '@/lib/blog';
import { blogPostingJsonLd } from '@/lib/jsonld';
import { BLOG_CONTENT } from '@/lib/mdx';
import { OG_IMAGE } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

interface PostParams {
  readonly slug: BlogSlug;
}

export function generateStaticParams(): PostParams[] {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<PostParams>;
}): Promise<Metadata> {
  const post = findPost((await params).slug);
  if (post === undefined) return {};
  const path = `/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      locale: 'en_IN',
      siteName: SITE_NAME,
      url: path,
      title: `${post.title} — ${SITE_NAME}`,
      description: post.description,
      publishedTime: post.published,
      images: [OG_IMAGE],
    },
  };
}

export default async function BlogPostPage({ params }: { readonly params: Promise<PostParams> }) {
  const { slug } = await params;
  const post = findPost(slug);
  if (post === undefined) notFound();
  const { default: Content } = await BLOG_CONTENT[slug]();
  const next = BLOG_POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <>
      <div aria-hidden="true" className="read-progress" />
      <JsonLd data={blogPostingJsonLd(post)} />
      <article aria-labelledby="page-title">
        <header className="bg-midnight text-on-midnight">
          <div className="wrap flex max-w-[880px] flex-col gap-6 pt-14 pb-16 md:pt-16">
            <nav aria-label="Breadcrumb" className="text-[15px] text-on-midnight-muted">
              <Link className="underline underline-offset-4 hover:text-on-midnight" href="/blog">
                Blog
              </Link>{' '}
              / <span>{post.category}</span>
            </nav>
            <h1
              id="page-title"
              className="font-display text-[clamp(44px,6vw,80px)] leading-[0.92] font-black"
            >
              {post.title}
            </h1>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-on-midnight-muted">
                By the ParkEase team,{' '}
                <time dateTime={post.published}>{formatPostDate(post.published)}</time>,{' '}
                {post.minutes} min read
              </p>
              <CopyLinkButton url={`${SITE_URL}/blog/${post.slug}`} />
            </div>
          </div>
        </header>
        <div className="wrap max-w-[880px] py-16">
          <div className="prose-pe max-w-[680px]">
            <Content />
          </div>
          <div className="mt-16 flex flex-wrap items-center justify-between gap-5 rounded-3xl bg-paper p-7 shadow-[inset_0_0_0_1px_var(--pe-rule)]">
            <p className="flex flex-col">
              <span className="text-xl font-extrabold">Ready for the real thing?</span>
              <span className="text-slate">See what’s free near you right now.</span>
            </p>
            <Link className="btn btn-ink" href="/#get-the-app">
              Get the app
            </Link>
          </div>
        </div>
      </article>
      <section aria-labelledby="next-title" className="bg-paper">
        <div className="wrap flex max-w-[880px] flex-col gap-6 py-20">
          <h2 id="next-title" className="type-section">
            Read next
          </h2>
          <ul className="border-b border-rule">
            {next.map((p) => (
              <li key={p.slug}>
                <PostRow post={p} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

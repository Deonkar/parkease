import Link from 'next/link';

import type { BlogPost } from '@/lib/blog';

export function PostRow({
  post,
  headingLevel = 'h3',
}: {
  readonly post: BlogPost;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="link-row grid gap-x-10 gap-y-2 border-t border-rule py-7 md:grid-cols-[140px_1fr_auto] md:items-baseline"
    >
      <span className="eyebrow">{post.category}</span>
      <span className="flex flex-col gap-1.5">
        <Heading className="link-row-title text-[clamp(22px,2.2vw,28px)] leading-tight font-extrabold">
          {post.title}
        </Heading>
        <span className="max-w-[640px] leading-relaxed text-slate">{post.description}</span>
      </span>
      <span className="text-[15px] text-slate">{post.minutes} min read</span>
    </Link>
  );
}

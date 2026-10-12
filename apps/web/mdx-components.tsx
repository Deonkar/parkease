import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

import { slugify } from '@/lib/slug';

/** Internal links in MDX go through next/link; external ones open as plain anchors. */
function MdxLink({ href = '', children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href.startsWith('/')) return <Link href={href}>{children}</Link>;
  return <a href={href}>{children}</a>;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
}

/** Section headings get stable ids so the table of contents and shared links can point at them. */
function MdxH2({ children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 id={slugify(textOf(children))} {...rest}>
      {children}
    </h2>
  );
}

const components: MDXComponents = {
  a: MdxLink,
  h2: MdxH2,
};

export function useMDXComponents(): MDXComponents {
  return components;
}

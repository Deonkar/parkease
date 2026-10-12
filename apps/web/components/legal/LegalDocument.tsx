import Link from 'next/link';

import { formatPostDate } from '@/lib/blog';
import { LEGAL_DOCS, LEGAL_STATUS, legalDoc } from '@/lib/legal';
import { LEGAL_CONTENT, type LegalDoc } from '@/lib/mdx';
import { PAGES } from '@/lib/pages';
import { slugify } from '@/lib/slug';

/** One legal document: the four documents as tabs, a contents list, and the MDX body. */
export async function LegalDocument({ doc }: { readonly doc: LegalDoc }) {
  const meta = legalDoc(doc);
  const page = PAGES[meta.page];
  const { default: Content } = await LEGAL_CONTENT[doc]();

  return (
    <>
      <section aria-labelledby="page-title" className="bg-midnight text-on-midnight">
        <div className="wrap flex flex-col gap-10 pt-14 md:pt-16">
          <h1 id="page-title" className="type-page">
            <span className="rise-line">
              <span>{page.title}</span>
            </span>
          </h1>
          <nav aria-label="Legal documents" className="-mb-px flex gap-1 overflow-x-auto">
            {LEGAL_DOCS.map((d) => {
              const current = d.doc === doc;
              return (
                <Link
                  key={d.doc}
                  href={PAGES[d.page].path}
                  aria-current={current ? 'page' : undefined}
                  className={`shrink-0 rounded-t-xl px-5 py-3.5 text-[17px] font-bold ${
                    current
                      ? 'bg-porcelain text-ink'
                      : 'text-on-midnight-muted hover:text-on-midnight'
                  }`}
                >
                  {d.tab}
                </Link>
              );
            })}
          </nav>
        </div>
      </section>
      <div className="wrap flex flex-wrap gap-x-20 gap-y-10 py-16 md:py-20">
        <aside className="flex flex-[1_1_240px] flex-col gap-6 md:max-w-[280px]">
          {LEGAL_STATUS.draft && (
            <p className="rounded-xl bg-warn-soft px-4 py-3 text-[15px] font-bold text-warn-ink">
              Draft, pending legal review.
            </p>
          )}
          <p className="text-[15px] text-slate">
            Last updated{' '}
            <time dateTime={LEGAL_STATUS.updated}>{formatPostDate(LEGAL_STATUS.updated)}</time>
          </p>
          <nav aria-label="On this page" className="md:sticky md:top-28">
            <p className="mb-2 text-sm font-bold tracking-wide text-slate uppercase">
              On this page
            </p>
            <ul className="flex flex-col border-l-2 border-rule">
              {meta.sections.map((heading) => (
                <li key={heading}>
                  <a
                    className="-ml-0.5 block border-l-2 border-transparent py-1.5 pl-4 text-[15px] hover:border-ink"
                    href={`#${slugify(heading)}`}
                  >
                    {heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <article className="prose-pe max-w-[720px] min-w-0 flex-[1_1_560px]">
          <Content />
        </article>
      </div>
    </>
  );
}

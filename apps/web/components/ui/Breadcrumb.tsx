import Link from 'next/link';

/**
 * One level up, then where you are. Sits on the dark hero. `current` names the page itself
 * unless `isPage` is false (a blog post shows its category there, not its title again).
 */
export function Breadcrumb({
  parent,
  current,
  isPage = true,
}: {
  readonly parent: { readonly href: string; readonly label: string };
  readonly current: string;
  readonly isPage?: boolean;
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-[15px] text-on-midnight-muted">
      <Link
        className="inline-block py-2.5 underline underline-offset-4 hover:text-on-midnight"
        href={parent.href}
      >
        {parent.label}
      </Link>{' '}
      / <span aria-current={isPage ? 'page' : undefined}>{current}</span>
    </nav>
  );
}

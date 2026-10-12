import Link from 'next/link';

export function Logo() {
  return (
    <Link href="/" className="mr-auto flex items-center gap-2.5 text-on-midnight no-underline">
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-[7px] bg-primary font-display text-[26px] leading-none font-black text-on-primary shadow-[inset_0_0_0_2px_var(--pe-on-primary)]"
      >
        P
      </span>
      <span className="font-display text-[27px] font-extrabold">ParkEase</span>
    </Link>
  );
}

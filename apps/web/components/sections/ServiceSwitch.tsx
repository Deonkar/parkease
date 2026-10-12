import Link from 'next/link';

export function ServiceSwitch({ current }: { readonly current: 'valet' | 'car-wash' }) {
  const item = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`press inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-bold no-underline ${active ? 'bg-porcelain text-midnight' : 'text-on-midnight shadow-[inset_0_0_0_1.5px_var(--pe-midnight-rule)]'}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Services" className="flex gap-2">
      {item('/valet', 'Valet', current === 'valet')}
      {item('/car-wash', 'Car wash', current === 'car-wash')}
    </nav>
  );
}

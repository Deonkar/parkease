import type { FaqItem } from '@/lib/faq';

export function FaqAccordion({ items }: { readonly items: readonly FaqItem[] }) {
  return (
    <div className="border-t-2 border-ink">
      {items.map((item) => (
        <details key={item.question} className="faq border-b border-rule">
          <summary className="flex min-h-[72px] items-center justify-between gap-4 text-[19px] font-bold">
            <span>{item.question}</span>
            <svg
              className="chevron shrink-0"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </summary>
          <p className="faq-answer mb-6 max-w-[62ch] text-[17px] leading-relaxed text-slate">
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}

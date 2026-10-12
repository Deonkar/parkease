export interface Step {
  readonly title: string;
  readonly body: string;
}

export function NumberedSteps({ steps }: { readonly steps: readonly Step[] }) {
  return (
    <ol className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-x-8 gap-y-10">
      {steps.map((step, i) => (
        <li key={step.title} className="flex flex-col gap-3 border-t-2 border-ink pt-5">
          <span
            aria-hidden="true"
            className="font-stencil text-[56px] leading-none font-extrabold text-primary"
          >
            {i + 1}
          </span>
          <h3 className="type-card">{step.title}</h3>
          <p className="leading-relaxed text-slate">{step.body}</p>
        </li>
      ))}
    </ol>
  );
}

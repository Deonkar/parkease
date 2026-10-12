export interface Step {
  readonly title: string;
  readonly body: string;
}

export function NumberedSteps({
  steps,
  dark = false,
}: {
  readonly steps: readonly Step[];
  readonly dark?: boolean;
}) {
  return (
    <ol className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-x-8 gap-y-10">
      {steps.map((step, i) => (
        <li
          key={step.title}
          className={`flex flex-col gap-3 border-t-2 pt-5 ${dark ? 'border-on-midnight' : 'border-ink'}`}
        >
          <span
            aria-hidden="true"
            className={`font-stencil text-[56px] leading-none font-extrabold ${dark ? 'text-sky' : 'text-primary'}`}
          >
            {i + 1}
          </span>
          <h3 className="type-card">{step.title}</h3>
          <p className={`leading-relaxed ${dark ? 'text-on-midnight-muted' : 'text-slate'}`}>
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  );
}

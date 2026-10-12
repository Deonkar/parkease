import { PhotoTile } from '@/components/ui/PhotoTile';

/** The in-app wash record: the product's proof, shown without inventing a photo. */
export function WashProof() {
  const timeline = [
    ['Partner arrived at your bay', '1:58pm'],
    ['Before photo added', '2:04pm'],
    ['After photo added', '2:41pm'],
  ] as const;
  return (
    <div className="flex max-w-[580px] min-w-0 flex-[1_1_520px] flex-col gap-5 rounded-3xl bg-paper p-6 shadow-[0_30px_60px_-30px_var(--pe-shadow)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[19px] font-extrabold">Premium wash</p>
          <p className="mt-0.5 text-[15px] text-slate">Bay 16, 12th Main, Indiranagar</p>
        </div>
        <span className="rounded-md bg-mist px-2.5 py-1.5 text-sm font-bold whitespace-nowrap">
          Finished 2:41pm
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Before', '2:04pm'],
          ['After', '2:41pm'],
        ].map(([label, time]) => (
          <figure key={label} className="flex flex-col gap-2">
            <div role="img" aria-label={`${String(label)} photo, taken by the wash partner`}>
              <PhotoTile label={`${String(label)} photo`} className="aspect-[4/3] rounded-[14px]" />
            </div>
            <figcaption className="text-sm text-slate">
              <strong className="text-ink">{label}</strong>, {time}
            </figcaption>
          </figure>
        ))}
      </div>
      <ol className="border-t border-rule">
        {timeline.map(([what, when]) => (
          <li
            key={what}
            className="flex justify-between gap-3 border-b border-rule py-3 text-[15px] last:border-b-0"
          >
            <span>{what}</span>
            <span className="text-slate">{when}</span>
          </li>
        ))}
      </ol>
      <span className="inline-flex h-11 items-center self-start rounded-[10px] bg-ink px-[18px] font-bold text-paper">
        Rate this wash
      </span>
    </div>
  );
}

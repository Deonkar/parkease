import { streetMapSvg, type StreetMapOptions } from '@/lib/map/svg';

export { MAP_ATTRIBUTION } from '@/lib/map/svg';

/** The map drawn inline, for where it is above the fold or animated. */
export function StreetMap(props: StreetMapOptions) {
  return (
    <div
      aria-hidden="true"
      className="size-full"
      dangerouslySetInnerHTML={{ __html: streetMapSvg(props) }}
    />
  );
}

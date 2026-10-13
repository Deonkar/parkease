import { describe, expect, it } from 'vitest';

import { MAP_PINS } from '@/lib/map/indiranagar';
import { streetMapSvg } from '@/lib/map/svg';

describe('streetMapSvg', () => {
  it.each(['light', 'dark'] as const)('%s map is a standalone, complete SVG', (theme) => {
    const svg = streetMapSvg({ theme });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/undefined|NaN/);
    expect(svg.match(/<text /g)?.length).toBeGreaterThanOrEqual(MAP_PINS.length);
  });

  it('only animates pins when asked', () => {
    expect(streetMapSvg({ theme: 'dark' })).not.toContain('map-pin');
    expect(streetMapSvg({ theme: 'dark', animatePins: true })).toContain('class="map-pin"');
  });

  it('escapes a font family so it cannot break the attribute', () => {
    expect(streetMapSvg({ theme: 'light', fontFamily: 'A "B" <C>' })).toContain(
      'style="font-family:A &quot;B&quot; &lt;C&gt;"',
    );
  });
});

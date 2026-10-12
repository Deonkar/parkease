/**
 * A decorative QR-style pattern for the booking pass illustration: three finder squares and
 * deterministic modules. It encodes nothing and is never meant to scan.
 */
export function qrPatternPath(size = 21, seedStart = 20261007): string {
  let seed = seedStart;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const inFinder = (x: number, y: number): boolean =>
    (x < 8 && y < 8) || (x > size - 9 && y < 8) || (x < 8 && y > size - 9);
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inFinder(x, y) && rnd() < 0.5) d += `M${String(x)} ${String(y)}h1v1h-1z`;
    }
  }
  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ] as const) {
    d += `M${String(ox)} ${String(oy)}h7v7h-7zM${String(ox + 1)} ${String(oy + 1)}v5h5v-5zM${String(ox + 2)} ${String(oy + 2)}h3v3h-3z`;
  }
  return d;
}

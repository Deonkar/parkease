// Copies MapLibre's web worker into public/maplibre/, where Expo's web build serves it
// and where ParkMap points MapLibre (MAPLIBRE_WORKER_URL in packages/ui-native/src/web-map.ts).
//
// Why: under Metro, MapLibre 6 resolves its worker against the bundle's URL and gets the
// app's HTML fallback page instead, so the web map never processes a style or a tile.
// The worker is an ES module importing ./maplibre-gl-shared.mjs; it and every chunk it imports ship.
// Runs on postinstall; the copies are gitignored, so they always match the installed version.
//
// Usage: node scripts/copy-maplibre-worker.mjs [destDir]   (default: public/maplibre)
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = 'maplibre-gl-worker.mjs';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = process.argv[2] ?? join(mobileRoot, 'public', 'maplibre');

try {
  const dist = dirname(createRequire(join(mobileRoot, 'package.json')).resolve('maplibre-gl/dist/maplibre-gl.css'));
  mkdirSync(dest, { recursive: true });
  // Follow the worker's relative imports rather than a fixed list, so a MapLibre release
  // that splits out another chunk is copied too instead of failing in the browser.
  const pending = [ENTRY];
  const copied = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (copied.has(file)) continue;
    copyFileSync(join(dist, file), join(dest, file));
    copied.add(file);
    for (const [, dep] of readFileSync(join(dist, file), 'utf8').matchAll(/(?:from|import)\s*["']\.\/([\w.-]+\.mjs)["']/g)) {
      pending.push(dep);
    }
  }
} catch (error) {
  // The copies are gitignored: without them the web map is blank, so stop the install.
  console.error(`copy-maplibre-worker: could not copy the MapLibre worker into ${dest}; the web map will be blank.`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

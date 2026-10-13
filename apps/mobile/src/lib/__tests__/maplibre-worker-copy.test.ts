import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = join(mobileRoot, 'scripts', 'copy-maplibre-worker.mjs');
const dist = dirname(
  createRequire(join(mobileRoot, 'package.json')).resolve('maplibre-gl/dist/maplibre-gl.css'),
);

// MapLibre 6's worker is an ES module that imports `./maplibre-gl-shared.mjs`, so both
// files must be served side by side — the worker alone still fails (see ParkMap S-98).
const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

describe('copy-maplibre-worker', () => {
  let out = '';
  afterEach(() => {
    if (out) rmSync(out, { recursive: true, force: true });
  });

  it('copies the worker and the shared chunk it imports, byte for byte', () => {
    out = mkdtempSync(join(tmpdir(), 'maplibre-worker-'));
    execFileSync(process.execPath, [script, out]);
    for (const file of FILES) {
      expect(readFileSync(join(out, file)).equals(readFileSync(join(dist, file)))).toBe(true);
    }
  });

  // A future MapLibre that splits out another chunk must not pass here and break in the
  // browser: every relative import of every copied module has to be there too.
  it('copies every module the worker imports, not a fixed list', () => {
    out = mkdtempSync(join(tmpdir(), 'maplibre-worker-'));
    execFileSync(process.execPath, [script, out]);
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(join(out, file), 'utf8');
      for (const [, dep] of source.matchAll(/(?:from|import)\s*["']\.\/([\w.-]+\.mjs)["']/g)) {
        if (dep) visit(dep);
      }
    };
    visit('maplibre-gl-worker.mjs');
    expect([...seen].sort()).toEqual(expect.arrayContaining(FILES));
  });

  // The copies are gitignored, so a failed copy must stop the install, and say what breaks.
  it('fails the install loudly, naming the web map, when it cannot write', () => {
    out = mkdtempSync(join(tmpdir(), 'maplibre-worker-'));
    const blocker = join(out, 'not-a-dir');
    writeFileSync(blocker, '');
    const run = spawnSync(process.execPath, [script, join(blocker, 'maplibre')], {
      encoding: 'utf8',
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/web map/i);
  });
});

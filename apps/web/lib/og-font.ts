import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Big Shoulders Black (SIL Open Font License), bundled so generated images never depend on a
 * network fetch at build or request time.
 */
export function loadDisplayFont(): Promise<Buffer> {
  return readFile(join(process.cwd(), 'assets', 'BigShoulders-Black.ttf'));
}

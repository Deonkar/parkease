import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * J3: a request body is a contract consumer too (learnings.md, "A shared Zod
 * contract does not make the client and the server agree about the wire").
 * Accept has no fields today; sending the contract's parse of `{}` rather than
 * a hand-written `{}` means the day the contract gains a field, this call
 * fails typecheck or parse instead of quietly sending the old shape.
 */
const api = readFileSync(
  join(process.cwd(), 'src', 'features', 'washer', 'api', 'washer.ts'),
  'utf8',
);

describe('the washer API bodies', () => {
  it('builds the accept body through acceptWashJobSchema', () => {
    expect(api).toMatch(/\/accept`,[\s\S]{0,200}acceptWashJobSchema\.parse\(\{\}\)/);
  });

  it('hand-writes no body for any write', () => {
    const writes = api.match(/api\.(post|put|patch)<?[^(]*\(\s*[^,]+,\s*[^,\n]+/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const call of writes) expect(call).not.toMatch(/,\s*\{\s*\}\s*$/);
  });
});

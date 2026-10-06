import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const ROOTS = [join(REPO, 'apps', 'api', 'src'), join(REPO, 'packages', 'db', 'src')];

/**
 * Who may write a `user_roles` row, and so who may mint an `admin`.
 *
 * Granting a role is the most privileged write in the system: an `admin` role is a key to the
 * admin panel. So the set of files able to write one is pinned here. A new writer fails this test
 * until a person adds it below with a reason a reviewer can disagree with. The list is the review.
 *
 * `expectWrite: false` is for a file kept on the list because a write belongs there, not because
 * one is there today; every other entry must still contain a write, so a deleted writer cannot
 * leave a stale permission behind.
 */
const ALLOWED_WRITERS: ReadonlyArray<{
  readonly file: string;
  readonly reason: string;
  readonly expectWrite: boolean;
}> = [
  {
    file: 'apps/api/src/domains/identity/commands/grant-role.command.ts',
    reason: 'The admin grant: the only runtime path to a new role, audited with the reason.',
    expectWrite: true,
  },
  {
    file: 'apps/api/src/domains/identity/commands/revoke-role.command.ts',
    reason: 'The admin revoke: suspends a role, audited with the reason.',
    expectWrite: true,
  },
  {
    file: 'apps/api/src/domains/identity/commands/review-partner.command.ts',
    reason:
      'Partner verification: status transitions on an existing valet or washer role; audited.',
    expectWrite: true,
  },
  {
    file: 'apps/api/src/domains/identity/repositories/role.repository.ts',
    reason: 'The role repository; reads today, and the sanctioned home for any future role write.',
    expectWrite: false,
  },
  {
    file: 'packages/db/src/seed/bootstrap-admin.ts',
    reason:
      'Release-time bootstrap of the first admin from env; runs by hand, never at request time.',
    expectWrite: true,
  },
  {
    file: 'packages/db/src/seed/dev/seed-dev.ts',
    reason: 'Developer fixtures (driver, owner, valet, washer; never admin) for a local database.',
    expectWrite: true,
  },
];

const SOURCE = /\.ts$/;
const TEST_FILE = /\.(spec|test)\.ts$/;
const TABLE = /\buserRoles\b|\buser_roles\b/;
const WRITE =
  /\.(insert|update)\(\s*userRoles\b|\b(insert\s+into|update)\s+user_roles\b|\bon\s+conflict\b[^;]*\buser_roles\b/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const posix = (path: string): string => relative(REPO, path).split(sep).join('/');

/** Every source file that names the table AND writes to it. */
function writers(): string[] {
  return ROOTS.flatMap(walk)
    .filter((path) => SOURCE.test(path) && !TEST_FILE.test(path))
    .filter((path) => {
      const text = readFileSync(path, 'utf8');
      return TABLE.test(text) && WRITE.test(text);
    })
    .map(posix)
    .sort();
}

describe('who may write a user_roles row', () => {
  it('only the allow-listed files write one', () => {
    const allowed = new Set(ALLOWED_WRITERS.map((w) => w.file));

    const unexpected = writers().filter((file) => !allowed.has(file));

    expect(
      unexpected,
      'A file that writes user_roles can mint an admin. Add it to ALLOWED_WRITERS with a reason, or remove the write.',
    ).toEqual([]);
  });

  it('every allow-listed writer still exists and still writes, so none is stale', () => {
    const found = new Set(writers());

    const stale = ALLOWED_WRITERS.filter((w) => w.expectWrite && !found.has(w.file)).map(
      (w) => w.file,
    );

    expect(stale).toEqual([]);
    for (const w of ALLOWED_WRITERS) expect(w.reason.length, w.file).toBeGreaterThan(20);
  });

  it('the detector sees the write forms the codebase uses', () => {
    const forms = [
      'await tx.insert(userRoles).values({ userId, role })',
      'await tx.update(userRoles).set({ status })',
      'INSERT INTO user_roles (user_id, role) VALUES (1, 2)',
      'update user_roles set status = 1',
    ];
    for (const form of forms) expect(WRITE.test(form), form).toBe(true);

    expect(WRITE.test('tx.select().from(userRoles)')).toBe(false);
    expect(WRITE.test('JOIN user_roles ur ON ur.user_id = c.user_id')).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { CreateSessionCommand } from '../src/domains/identity/commands/create-session.command.js';

/**
 * `withTransaction` is the real thing over a double `db`, so a throw inside the
 * callback surfaces as a rejected execute() — the same path Postgres takes to
 * roll the issued refresh-token row back.
 */
function build(activeRoles: string[]) {
  const tx = {};
  const db = { transaction: (cb: (t: unknown) => Promise<unknown>) => cb(tx) };

  const issue = vi.fn().mockResolvedValue({
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 900,
  });

  const command = new CreateSessionCommand(
    { verify: vi.fn().mockResolvedValue({ uid: 'fb-1', phone: '+910000000000' }) } as never,
    { issue } as never,
    {
      upsertByPhone: vi.fn().mockResolvedValue({ id: 'user-1', status: 'active', isNew: false }),
    } as never,
    { listActive: vi.fn().mockResolvedValue(activeRoles.map((role) => ({ role }))) } as never,
    { enqueue: vi.fn().mockResolvedValue(undefined) } as never,
    db as never,
  );
  return { command, issue };
}

describe('CreateSessionCommand requireRole (task 18a)', () => {
  it('403s ADMIN_ROLE_REQUIRED before issuing a token when the role is not active', async () => {
    const { command, issue } = build(['driver']);

    await expect(command.execute({ idToken: 't', requireRole: 'admin' })).rejects.toMatchObject({
      status: 403,
      response: { error: 'ADMIN_ROLE_REQUIRED' },
    });

    expect(issue).not.toHaveBeenCalled();
  });

  it('makes the required role the active one even when another sorts first', async () => {
    const { command, issue } = build(['driver', 'admin']);

    const result = await command.execute({ idToken: 't', requireRole: 'admin' });

    expect(result.activeRole).toBe('admin');
    expect(issue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ activeRole: 'admin', roles: ['driver', 'admin'] }),
    );
  });

  it('without requireRole keeps the first role', async () => {
    const { command } = build(['driver', 'admin']);
    const result = await command.execute({ idToken: 't' });
    expect(result.activeRole).toBe('driver');
  });
});

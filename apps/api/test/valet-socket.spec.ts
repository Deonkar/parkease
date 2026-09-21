import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocationService } from '../src/domains/valet/location.service.js';
import { ValetTrackingPublisher } from '../src/domains/valet/tracking.publisher.js';
import type { ValetService } from '../src/domains/valet/valet.service.js';
import type { TokenService } from '../src/platform/auth/token.service.js';
import { authenticateHandshake, extractHandshakeToken } from '../src/platform/realtime/ws-auth.js';
import { ValetTrackingGateway } from '../src/roles/valet/tracking.gateway.js';

/**
 * The authorisation matrix from §11.7, exercised against the gateway directly.
 *
 * Unit-level on purpose: every row in that table is a decision made by
 * `participantRole` / `findAssignedTo` and nothing else, so driving it through a
 * real socket would test socket.io rather than the rule. The handshake and the
 * room isolation are covered end-to-end in the integration suite; this file is
 * about the decisions.
 */

const DRIVER = '0192f0a1-0000-7000-8000-00000000d111';
const VALET = '0192f0a1-0000-7000-8000-00000000v222'.replace(/v/g, 'a');
const OTHER_DRIVER = '0192f0a1-0000-7000-8000-00000000d333';
const LOSER_VALET = '0192f0a1-0000-7000-8000-00000000a444';
const JOB = '0192f2a1-0000-7000-8000-0000000000b1';

interface FakeSocket {
  data: { user?: { id: string; roles: readonly string[]; activeRole: string | null } };
  handshake: { auth?: Record<string, unknown>; headers?: Record<string, string> };
  joined: string[];
  emitted: { event: string; payload: unknown }[];
  disconnected: boolean;
  join(room: string): Promise<void>;
  emit(event: string, payload: unknown): void;
  disconnect(close: boolean): void;
}

function makeSocket(userId: string | null, handshake: FakeSocket['handshake'] = {}): FakeSocket {
  const socket: FakeSocket = {
    data: {},
    handshake,
    joined: [],
    emitted: [],
    disconnected: false,
    join: async (room) => {
      socket.joined.push(room);
    },
    emit: (event, payload) => {
      socket.emitted.push({ event, payload });
    },
    disconnect: () => {
      socket.disconnected = true;
    },
  };

  if (userId !== null) {
    socket.data.user = { id: userId, roles: ['valet', 'driver'], activeRole: 'valet' };
  }
  return socket;
}

/** A job owned by DRIVER and assigned to VALET, in a tracked status. */
function makeValetService(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    participantRole: vi.fn(async (jobId: string, userId: string) => {
      if (jobId !== JOB) return null;
      if (userId === DRIVER) return 'driver';
      if (userId === VALET) return 'valet';
      return null;
    }),
    findAssignedTo: vi.fn(async (jobId: string, userId: string) =>
      jobId === JOB && userId === VALET ? { id: JOB, status: 'en_route' } : undefined,
    ),
    ...overrides,
  } as unknown as ValetService;
}

function makeLocationService(last: unknown = null) {
  return {
    lastKnown: vi.fn(async () => last),
    record: vi.fn(async (u: { lat: number; lng: number }) => ({
      lat: u.lat,
      lng: u.lng,
      at: 1_700_000_000_000,
    })),
    forget: vi.fn(async () => undefined),
  } as unknown as LocationService;
}

const makeTokens = (payload: unknown): TokenService =>
  ({
    verifyAccessToken: vi.fn(async () => {
      if (payload === null) throw new Error('Invalid or expired token.');
      return payload;
    }),
  }) as unknown as TokenService;

function makeGateway(valet: ValetService, location = makeLocationService()) {
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  const server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  };

  const gateway = new ValetTrackingGateway(
    makeTokens({ sub: VALET, roles: ['valet'], active_role: 'valet' }),
    valet,
    location,
    new ValetTrackingPublisher(),
  );
  (gateway as unknown as { server: unknown }).server = server;

  return { gateway, emitted };
}

describe('extractHandshakeToken', () => {
  it('prefers auth.token, which is the only channel a browser client controls', () => {
    expect(extractHandshakeToken({ auth: { token: 'abc' } })).toBe('abc');
  });

  it('strips a Bearer prefix from auth.token', () => {
    expect(extractHandshakeToken({ auth: { token: 'Bearer abc' } })).toBe('abc');
  });

  it('falls back to the Authorization header for native clients', () => {
    expect(extractHandshakeToken({ headers: { authorization: 'Bearer xyz' } })).toBe('xyz');
  });

  it('is null when there is no token, rather than an empty string', () => {
    expect(extractHandshakeToken({})).toBeNull();
    expect(extractHandshakeToken({ headers: { authorization: 'Bearer ' } })).toBeNull();
    expect(extractHandshakeToken({ auth: { token: '' } })).toBeNull();
  });

  it('ignores a non-Bearer Authorization header', () => {
    expect(extractHandshakeToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
  });
});

describe('authenticateHandshake', () => {
  it('accepts a valid access token and carries the roles through', async () => {
    const user = await authenticateHandshake(
      makeTokens({ sub: DRIVER, roles: ['driver'], active_role: 'driver' }),
      { auth: { token: 'good' } },
    );

    expect(user).toEqual({ id: DRIVER, roles: ['driver'], activeRole: 'driver' });
  });

  it('rejects a token the service refuses — expired, tampered, or a refresh token', async () => {
    expect(await authenticateHandshake(makeTokens(null), { auth: { token: 'bad' } })).toBeNull();
  });

  it('rejects a token with no subject', async () => {
    const tokens = makeTokens({ roles: ['driver'], active_role: null });
    expect(await authenticateHandshake(tokens, { auth: { token: 'nosub' } })).toBeNull();
  });

  it('does not call the token service at all when no token was sent', async () => {
    const tokens = makeTokens({ sub: DRIVER, roles: [], active_role: null });
    expect(await authenticateHandshake(tokens, {})).toBeNull();
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });
});

describe('handleConnection', () => {
  it('disconnects a handshake with no token, telling it why', async () => {
    const { gateway } = makeGateway(makeValetService());
    const socket = makeSocket(null, {});

    await gateway.handleConnection(socket as never);

    expect(socket.disconnected).toBe(true);
    expect(socket.emitted).toEqual([{ event: 'valet:error', payload: { code: 'UNAUTHORIZED' } }]);
    expect(socket.data.user).toBeUndefined();
  });

  it('attaches the user on a valid handshake', async () => {
    const { gateway } = makeGateway(makeValetService());
    const socket = makeSocket(null, { auth: { token: 'good' } });

    await gateway.handleConnection(socket as never);

    expect(socket.disconnected).toBe(false);
    expect(socket.data.user?.id).toBe(VALET);
  });
});

describe('valet:subscribe — who may watch a job', () => {
  let valet: ValetService;

  beforeEach(() => {
    valet = makeValetService();
  });

  it('lets the owning driver join and replays the last known fix', async () => {
    const location = makeLocationService({ lat: 12.93, lng: 77.62, at: 1 });
    const { gateway } = makeGateway(valet, location);
    const socket = makeSocket(DRIVER);

    const result = await gateway.subscribe(socket as never, { jobId: JOB });

    expect(result).toEqual({ subscribed: true });
    expect(socket.joined).toEqual([`job:${JOB}`]);
    expect(socket.emitted).toEqual([
      { event: 'valet:location', payload: { lat: 12.93, lng: 77.62, at: 1 } },
    ]);
  });

  it('lets the assigned valet join', async () => {
    const { gateway } = makeGateway(valet);
    const socket = makeSocket(VALET);

    expect(await gateway.subscribe(socket as never, { jobId: JOB })).toEqual({ subscribed: true });
    expect(socket.joined).toEqual([`job:${JOB}`]);
  });

  it('joins with no replay when there is no fix yet, rather than emitting null', async () => {
    const { gateway } = makeGateway(valet, makeLocationService(null));
    const socket = makeSocket(DRIVER);

    await gateway.subscribe(socket as never, { jobId: JOB });

    expect(socket.emitted).toEqual([]);
  });

  /**
   * The row this whole gateway exists for. `job:{uuid}` is guessable, and a
   * driver who guesses one must not receive somebody else's vehicle position.
   */
  it('refuses a different driver, and does not join them', async () => {
    const { gateway } = makeGateway(valet);
    const socket = makeSocket(OTHER_DRIVER);

    expect(await gateway.subscribe(socket as never, { jobId: JOB })).toEqual({
      error: 'FORBIDDEN',
    });
    expect(socket.joined).toEqual([]);
    expect(socket.emitted).toEqual([]);
  });

  it('refuses a valet who lost the accept race', async () => {
    const { gateway } = makeGateway(valet);
    const socket = makeSocket(LOSER_VALET);

    expect(await gateway.subscribe(socket as never, { jobId: JOB })).toEqual({
      error: 'FORBIDDEN',
    });
    expect(socket.joined).toEqual([]);
  });

  it('refuses an unauthenticated socket', async () => {
    const { gateway } = makeGateway(valet);
    const socket = makeSocket(null);

    expect(await gateway.subscribe(socket as never, { jobId: JOB })).toEqual({
      error: 'UNAUTHORIZED',
    });
    expect(valet.participantRole).not.toHaveBeenCalled();
  });

  it('rejects a malformed body without joining and without throwing', async () => {
    const { gateway } = makeGateway(valet);
    const socket = makeSocket(DRIVER);

    expect(await gateway.subscribe(socket as never, { jobId: 'not-a-uuid' })).toEqual({
      error: 'INVALID_PAYLOAD',
    });
    expect(await gateway.subscribe(socket as never, null)).toEqual({ error: 'INVALID_PAYLOAD' });
    expect(socket.joined).toEqual([]);
  });
});

describe('valet:location — who may report a position', () => {
  const fix = { jobId: JOB, lat: 12.9361, lng: 77.6229, headingDeg: 214 };

  it('accepts a fix from the assigned valet and broadcasts it to the room', async () => {
    const { gateway, emitted } = makeGateway(makeValetService());
    const socket = makeSocket(VALET);

    expect(await gateway.ingest(socket as never, fix)).toEqual({ accepted: true });
    expect(emitted).toEqual([
      {
        room: `job:${JOB}`,
        event: 'valet:location',
        payload: { lat: 12.9361, lng: 77.6229, at: 1_700_000_000_000 },
      },
    ]);
  });

  /**
   * A driver subscribed to their own job is legitimately in the room, so room
   * membership cannot be what authorises a write. Without the re-check, a driver
   * could fabricate "your car is two streets away", which is worse than no
   * tracking at all.
   */
  it('refuses a driver reporting a position for their own job', async () => {
    const valet = makeValetService();
    const { gateway, emitted } = makeGateway(valet);
    const socket = makeSocket(DRIVER);

    expect(await gateway.ingest(socket as never, fix)).toEqual({ error: 'FORBIDDEN' });
    expect(emitted).toEqual([]);
  });

  it('refuses a valet reporting for a job assigned to somebody else', async () => {
    const { gateway, emitted } = makeGateway(makeValetService());
    const socket = makeSocket(LOSER_VALET);

    expect(await gateway.ingest(socket as never, fix)).toEqual({ error: 'FORBIDDEN' });
    expect(emitted).toEqual([]);
  });

  it('refuses an unauthenticated socket', async () => {
    const { gateway, emitted } = makeGateway(makeValetService());

    expect(await gateway.ingest(makeSocket(null) as never, fix)).toEqual({
      error: 'UNAUTHORIZED',
    });
    expect(emitted).toEqual([]);
  });

  it('rejects a malformed body and keeps the socket open', async () => {
    const { gateway, emitted } = makeGateway(makeValetService());
    const socket = makeSocket(VALET);

    for (const bad of [
      { jobId: JOB, lat: 91, lng: 77 },
      { jobId: JOB, lat: 12, lng: 181 },
      { jobId: JOB, lat: 12 },
      { jobId: 'nope', lat: 12, lng: 77 },
      { jobId: JOB, lat: 12, lng: 77, headingDeg: 360 },
      'not an object',
    ]) {
      expect(await gateway.ingest(socket as never, bad)).toEqual({ error: 'INVALID_PAYLOAD' });
    }

    expect(socket.disconnected).toBe(false);
    expect(emitted).toEqual([]);
  });

  /**
   * Streaming stops at `parked`: the car is stationary in a space whose address
   * the driver already has, and broadcasting its coordinates for hours is a
   * liability with no product value. Not an error — a handset flushing a queued
   * fix is behaving correctly.
   */
  it.each(['parked', 'return_requested', 'completed', 'cancelled', 'no_show'])(
    'stores and broadcasts nothing while the job is %s',
    async (status) => {
      const valet = makeValetService({
        findAssignedTo: vi.fn(async () => ({ id: JOB, status })),
      });
      const location = makeLocationService();
      const { gateway, emitted } = makeGateway(valet, location);

      expect(await gateway.ingest(makeSocket(VALET) as never, fix)).toEqual({ accepted: false });
      expect(emitted).toEqual([]);
      expect(location.record).not.toHaveBeenCalled();
    },
  );

  it.each(['accepted', 'en_route', 'arrived', 'returning'])(
    'streams while the job is %s',
    async (status) => {
      const valet = makeValetService({
        findAssignedTo: vi.fn(async () => ({ id: JOB, status })),
      });
      const { gateway, emitted } = makeGateway(valet);

      expect(await gateway.ingest(makeSocket(VALET) as never, fix)).toEqual({ accepted: true });
      expect(emitted).toHaveLength(1);
    },
  );
});

describe('ValetTrackingPublisher', () => {
  it('is a no-op before the gateway attaches a server, rather than throwing', () => {
    const publisher = new ValetTrackingPublisher();
    expect(() => {
      publisher.publishStatus(JOB, 'arrived');
    }).not.toThrow();
  });

  it('emits the status into the job room once attached', () => {
    const emitted: { room: string; event: string; payload: unknown }[] = [];
    const publisher = new ValetTrackingPublisher();
    publisher.attach({
      to: (room) => ({
        emit: (event, payload) => {
          emitted.push({ room, event, payload });
        },
      }),
    });

    publisher.publishStatus(JOB, 'parked');

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.room).toBe(`job:${JOB}`);
    expect(emitted[0]?.event).toBe('valet:status');
    expect(emitted[0]?.payload).toMatchObject({ jobId: JOB, status: 'parked' });
  });

  /**
   * A status push must never take down the request that caused it. The map
   * recovers on the next push; a 500 on a successfully parked car does not.
   */
  it('swallows nothing but does not rethrow when the server emit fails', () => {
    const publisher = new ValetTrackingPublisher();
    publisher.attach({
      to: () => ({
        emit: () => {
          throw new Error('socket server is gone');
        },
      }),
    });

    expect(() => {
      publisher.publishStatus(JOB, 'parked');
    }).not.toThrow();
  });
});

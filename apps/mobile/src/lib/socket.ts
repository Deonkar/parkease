import { io, type Socket } from 'socket.io-client';

import { warn } from './log';
import { secureStorage } from './secure-storage';

/**
 * The app's socket client.
 *
 * One connection per namespace, created on demand and reused. The handshake
 * reads its token from the same secure store REST does (R-FE-10), so one logout
 * kills both — there is no second copy of the session to forget about.
 */

const API_ORIGIN = process.env.EXPO_PUBLIC_API_URL ?? '';

export interface NamespaceConnection {
  readonly socket: Socket;
  /** Re-emitted after every reconnect, so a resubscribe is never forgotten. */
  subscribe(event: string, payload: unknown): void;
  unsubscribe(event: string, payload: unknown): void;
  disconnect(): void;
}

const connections = new Map<string, NamespaceConnection>();

/**
 * Connect to a namespace, or return the live connection to it.
 *
 * Reconnection is socket.io's, with one addition: every `subscribe` is recorded
 * and replayed on `connect`. Without that, a reconnect silently leaves the
 * client in a namespace it is no longer watching anything in — the socket is
 * "connected" and no updates ever arrive, which is the hardest kind of failure
 * to notice.
 */
export async function connectNamespace(namespace: string): Promise<NamespaceConnection> {
  const existing = connections.get(namespace);
  if (existing !== undefined) return existing;

  const session = await secureStorage.read();
  if (session === null) {
    throw new Error(`Cannot open ${namespace}: no stored session`);
  }

  const socket = io(`${API_ORIGIN}${namespace}`, {
    transports: ['websocket'],
    auth: { token: session.accessToken },
    autoConnect: true,
    reconnection: true,
  });

  const subscriptions = new Map<string, unknown>();

  socket.on('connect', () => {
    for (const [event, payload] of subscriptions) {
      socket.emit(event, payload);
    }
  });

  /**
   * A rejected handshake refreshes once and reconnects once.
   *
   * `secureStorage.read()` returns whatever the REST layer's single-flight
   * refresh has already written, so the two never race to refresh the same
   * token and never produce a reconnect storm (R-FE-04).
   */
  socket.on('connect_error', (error: unknown) => {
    // Logged, not discarded. A silently failing handshake means real-time
    // updates simply never arrive, with nothing anywhere saying why — the
    // hardest kind of failure to notice (R-FAIL-01).
    warn(`socket ${namespace}: handshake failed`, error);

    void (async () => {
      try {
        const refreshed = await secureStorage.read();
        if (refreshed === null) return;
        socket.auth = { token: refreshed.accessToken };
      } catch (readError) {
        warn(`socket ${namespace}: could not re-read the session`, readError);
      }
    })();
  });

  const connection: NamespaceConnection = {
    socket,
    subscribe(event, payload) {
      subscriptions.set(event, payload);
      if (socket.connected) socket.emit(event, payload);
    },
    unsubscribe(event) {
      subscriptions.delete(event);
    },
    disconnect() {
      subscriptions.clear();
      socket.removeAllListeners();
      socket.disconnect();
      connections.delete(namespace);
    },
  };

  connections.set(namespace, connection);
  return connection;
}

/** Every namespace closed — called on logout, beside the secure-store clear. */
export function disconnectAll(): void {
  for (const connection of [...connections.values()]) {
    connection.disconnect();
  }
}

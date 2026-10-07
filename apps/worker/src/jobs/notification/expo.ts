import Expo, { type ExpoPushMessage } from 'expo-server-sdk';

import { env } from '../../config/env.js';

export interface PushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, unknown>;
  /** The Android notification channel: one per category, so a user can mute one in system settings. */
  readonly channelId: string;
}

export type PushTicket =
  | { readonly status: 'ok'; readonly id: string }
  | { readonly status: 'error'; readonly error: string | undefined; readonly message: string };

export type PushReceipt =
  | { readonly status: 'ok' }
  | { readonly status: 'error'; readonly error: string | undefined; readonly message: string };

/**
 * What the worker needs of Expo's push service. Declared structurally so a test hands the jobs a
 * recorder rather than reaching the network, the same shape as the payout gateway.
 */
export interface PushGateway {
  /** One ticket per message, in the order sent — however many chunks that took. */
  send(messages: readonly PushMessage[]): Promise<PushTicket[]>;
  receipts(ticketIds: readonly string[]): Promise<Record<string, PushReceipt>>;
}

let client: Expo | undefined;
/** Built on first use: the access token is optional, and importing a job must not need a network. */
function expo(): Expo {
  client ??= new Expo(
    env.EXPO_ACCESS_TOKEN === undefined ? {} : { accessToken: env.EXPO_ACCESS_TOKEN },
  );
  return client;
}

/**
 * `expo-server-sdk` does the chunking and keeps tickets in message order across chunks. v1
 * hand-rolled this and indexed a chunk's response into the unchunked token list, so past the first
 * 100 tokens a `DeviceNotRegistered` deactivated the wrong device.
 */
export const expoPush: PushGateway = {
  async send(messages) {
    const tickets: PushTicket[] = [];
    for (const chunk of expo().chunkPushNotifications(messages as ExpoPushMessage[])) {
      for (const t of await expo().sendPushNotificationsAsync(chunk)) {
        tickets.push(
          t.status === 'ok'
            ? { status: 'ok', id: t.id }
            : { status: 'error', error: t.details?.error, message: t.message },
        );
      }
    }
    return tickets;
  },

  async receipts(ticketIds) {
    const out: Record<string, PushReceipt> = {};
    for (const chunk of expo().chunkPushNotificationReceiptIds([...ticketIds])) {
      const got = await expo().getPushNotificationReceiptsAsync(chunk);
      for (const [id, r] of Object.entries(got)) {
        out[id] =
          r.status === 'ok'
            ? { status: 'ok' }
            : { status: 'error', error: r.details?.error, message: r.message };
      }
    }
    return out;
  },
};

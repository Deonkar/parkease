import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  parseValetJobStatus,
  TRACKED_VALET_STATUSES,
  VALET_TRACKING_NAMESPACE,
  valetLocationSchema,
  ValetSocketEvent,
  valetSubscribeSchema,
} from '@parkease/contracts/valet';
import type { Server, Socket } from 'socket.io';

import { LocationService } from '../../domains/valet/location.service.js';
import { ValetTrackingPublisher, valetRoom } from '../../domains/valet/tracking.publisher.js';
import { ValetService } from '../../domains/valet/valet.service.js';
import type { AuthUser } from '../../platform/auth/current-user.decorator.js';
import { TokenService } from '../../platform/auth/token.service.js';
import { env } from '../../platform/config/env.schema.js';
import { authenticateHandshake } from '../../platform/realtime/ws-auth.js';

interface SocketWithUser extends Socket {
  data: { user?: AuthUser };
}

@WebSocketGateway({
  namespace: VALET_TRACKING_NAMESPACE,
  // An allowlist, never '*' (R-SEC-06). A wildcard here would let any origin
  // open an authenticated socket from a logged-in browser.
  cors: { origin: env.CORS_ALLOWED_ORIGINS, credentials: true },
})
export class ValetTrackingGateway {
  @WebSocketServer() private readonly server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly valet: ValetService,
    private readonly location: LocationService,
    private readonly publisher: ValetTrackingPublisher,
  ) {}

  /**
   * Hands the live server to the publisher, which is what lets a driver-side
   * status change reach this namespace without `roles/driver` importing
   * `roles/valet` (ADR-016, R-ARCH-04).
   */
  afterInit(server: Server): void {
    this.publisher.attach(server);
  }

  /**
   * A handshake without a valid access token is disconnected before it can emit
   * anything. The client is told why — an app that cannot distinguish "your
   * token expired" from "the network died" will retry forever against a 401.
   */
  async handleConnection(client: SocketWithUser): Promise<void> {
    const user = await authenticateHandshake(this.tokens, client.handshake);

    if (user === null) {
      client.emit(ValetSocketEvent.ERROR, { code: 'UNAUTHORIZED' });
      client.disconnect(true);
      return;
    }

    client.data.user = user;
  }

  /**
   * Room joins are authorised per job.
   *
   * A driver may watch only a job they own; a valet only one assigned to them.
   * Without this check `job:{uuid}` is a guessable channel carrying someone
   * else's live vehicle position — the most sensitive stream in the product,
   * which security.md §5.3 makes visible to those two people and nobody else.
   * A valet who lost the accept race is nobody else.
   */
  @SubscribeMessage(ValetSocketEvent.SUBSCRIBE)
  async subscribe(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: unknown,
  ): Promise<{ subscribed: true } | { error: string }> {
    const user = client.data.user;
    if (user === undefined) return { error: 'UNAUTHORIZED' };

    const parsed = valetSubscribeSchema.safeParse(body);
    if (!parsed.success) return { error: 'INVALID_PAYLOAD' };

    const role = await this.valet.participantRole(parsed.data.jobId, user.id);
    if (role === null) return { error: 'FORBIDDEN' };

    await client.join(valetRoom(parsed.data.jobId));

    // Late joiners get the last known fix immediately instead of an empty map.
    const last = await this.location.lastKnown(parsed.data.jobId);
    if (last !== null) client.emit(ValetSocketEvent.LOCATION, last);

    return { subscribed: true };
  }

  /**
   * Inbound from the valet app only.
   *
   * The participant role is re-checked here rather than trusted from the join,
   * and it must be `valet`: a driver subscribed to their own job is legitimately
   * in the room, so trusting room membership would let them forge their own
   * valet's position — and a fabricated "your car is two streets away" is worse
   * than no tracking at all.
   */
  @SubscribeMessage(ValetSocketEvent.LOCATION)
  async ingest(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: unknown,
  ): Promise<{ accepted: boolean } | { error: string }> {
    const user = client.data.user;
    if (user === undefined) return { error: 'UNAUTHORIZED' };

    // A socket frame skipped every HTTP pipe, so it is validated like any other
    // boundary (R-VAL-01). A malformed body is rejected; the socket stays open.
    const parsed = valetLocationSchema.safeParse(body);
    if (!parsed.success) return { error: 'INVALID_PAYLOAD' };

    const update = parsed.data;
    const job = await this.valet.findAssignedTo(update.jobId, user.id);
    if (job === undefined) return { error: 'FORBIDDEN' };

    /**
     * Parked, or over. Stored and broadcast nothing: the car is stationary in a
     * space whose address the driver already has, and a stream that keeps
     * running for hours afterwards is a liability with no product value.
     *
     * Not an error — a handset with a queued fix is behaving correctly, and
     * telling it otherwise would make a normal race look like a bug.
     */
    if (!TRACKED_VALET_STATUSES.includes(parseValetJobStatus(job.status))) {
      return { accepted: false };
    }

    const view = await this.location.record(update);
    this.server.to(valetRoom(update.jobId)).emit(ValetSocketEvent.LOCATION, view);

    return { accepted: true };
  }
}

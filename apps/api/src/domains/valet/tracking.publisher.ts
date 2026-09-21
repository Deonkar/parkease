import { Injectable } from '@nestjs/common';
import { ValetSocketEvent } from '@parkease/contracts/valet';

import { logger } from '../../platform/observability/logger.js';

/** The slice of a Socket.IO server this needs, declared structurally. */
export interface RoomEmitter {
  to(room: string): { emit(event: string, payload: unknown): unknown };
}

/** One room per job. Guessable, which is why joining it is authorised. */
export const valetRoom = (jobId: string): string => `job:${jobId}`;

/**
 * Pushes a job's status change to whoever is watching it.
 *
 * This lives in `domains/` rather than in `roles/valet/` for a reason ESLint
 * enforces: both the driver's controller and the valet's move the same job
 * through the same machine, and `roles/driver` importing `roles/valet` is a
 * layer violation (ADR-016, R-ARCH-04). §11.1 sketches this as a method on the
 * gateway; splitting the publish side out is what lets both roles reach it
 * without reaching across to each other.
 *
 * The gateway attaches the live server on init. Until it does — and in every
 * test that never opens a socket — publishing is a logged no-op rather than a
 * crash, because a status change must never take down the request that caused
 * it. A map that misses one push recovers on the next one; a 500 on a
 * successfully parked car does not.
 */
@Injectable()
export class ValetTrackingPublisher {
  private server: RoomEmitter | null = null;

  attach(server: RoomEmitter): void {
    this.server = server;
  }

  publishStatus(jobId: string, status: string): void {
    if (this.server === null) {
      logger.debug({ jobId, status }, 'valet status not published: no socket server attached');
      return;
    }

    try {
      this.server.to(valetRoom(jobId)).emit(ValetSocketEvent.STATUS, {
        jobId,
        status,
        at: Date.now(),
      });
    } catch (err: unknown) {
      logger.warn({ err, jobId, status }, 'could not publish a valet status change');
    }
  }
}

import {
  type DriverValetJob,
  driverValetJobSchema,
  type ValetCard,
  type ValetContact,
} from '@parkease/contracts/driver';
import type { ValetJobStatus } from '@parkease/contracts/enums';
import {
  parseValetJobStatus,
  type ValetLocationView,
  valetHoldsVehicle,
} from '@parkease/contracts/valet';

import type { ValetJobRow } from '../../../domains/valet/valet.service.js';

export interface DriverValetJobInput {
  readonly job: ValetJobRow;
  readonly offeredTo: number;
  readonly valet: ValetCard | null;
  readonly lastKnownLocation: ValetLocationView | null;
  readonly contact: ValetContact | null;
}

/**
 * Statuses from which a driver may still call the whole thing off.
 *
 * Derived from the machine, not listed: `cancel` is legal exactly where the
 * table says it is, and `valetHoldsVehicle` is the reason it stops. Hard-coding
 * the list here would be a third copy of the rule, and the one the button reads.
 */
const isCancellable = (status: ValetJobStatus): boolean =>
  !valetHoldsVehicle(status) &&
  status !== 'completed' &&
  status !== 'cancelled' &&
  status !== 'no_show';

export function toDriverValetJobView(input: DriverValetJobInput): DriverValetJob {
  const { job } = input;

  return driverValetJobSchema.parse({
    id: job.id,
    bookingId: job.bookingId,
    status: job.status,
    pickupAddress: job.pickupAddress,
    offerRadiusM: job.offerRadiusM,
    offerRound: job.offerRound,
    offeredTo: input.offeredTo,
    outboundLeg: {
      distanceM: job.distanceM,
      feePaise: job.feePaise,
      txnId: job.txnId,
    },
    returnLeg: {
      distanceM: job.returnDistanceM,
      feePaise: job.returnFeePaise,
      txnId: job.returnTxnId,
    },
    returnDropLocation: job.returnDropLocation,
    valet: input.valet,
    /**
     * A mode, never a number.
     *
     * Resolved upstream by `ContactChannelService`, which is the only thing that
     * reads the masked-calling flag. Masked calling is what stops a number being
     * exchanged at all (§11.9), so the flag being off does not fall back to
     * showing one — it falls back to a platform-mediated thread carrying the job
     * id, which support can use to reach either party. Neither variant of
     * `ValetContact` can hold a phone number, so no valet or driver number
     * appears in any response from this task, flag on or off (security.md §5.3).
     */
    contact: input.contact,
    lastKnownLocation: input.lastKnownLocation,
    cancellable: isCancellable(parseValetJobStatus(job.status)),
    proofPhotoId: job.proofPhotoId,
    cancellationReason: job.cancellationReason,
    requestedAt: job.createdAt.toISOString(),
    acceptedAt: job.acceptedAt?.toISOString() ?? null,
    parkedAt: job.parkedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  });
}

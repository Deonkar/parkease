import { Body, Controller, Post } from '@nestjs/common';
import {
  createOrderSchema,
  type PaymentOrder,
  type PaymentResult,
  verifyPaymentSchema,
} from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';

import { ConfirmPaymentCommand } from '../../domains/payment/commands/confirm-payment.command.js';
import { CreateOrderCommand } from '../../domains/payment/commands/create-order.command.js';
import { PaymentNotFoundError } from '../../domains/payment/errors.js';
import { PaymentService } from '../../domains/payment/payment.service.js';
import { VerificationService } from '../../domains/payment/verification.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

/**
 * Authorise and delegate, nothing more (rule 2).
 *
 * Both routes are 10/min per user (`security.md` §4.3) and both carry an
 * Idempotency-Key, enforced by the global `IdempotencyInterceptor`. Do NOT
 * declare that interceptor here as well — it then runs twice and every mutation
 * answers 409, which an earlier version of `bookings.controller.ts` did.
 */
@Controller('driver/payments')
@Roles(Role.DRIVER)
export class DriverPaymentsController {
  constructor(
    private readonly createOrder: CreateOrderCommand,
    private readonly confirmPayment: ConfirmPaymentCommand,
    private readonly payments: PaymentService,
    private readonly verification: VerificationService,
  ) {}

  @Post('orders')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<PaymentOrder> {
    const input = createOrderSchema.parse(body);
    return this.createOrder.execute({ bookingId: input.bookingId, driverId: user.id });
  }

  /**
   * The Checkout success callback. A convenience, never the source of truth:
   * `payment.captured` from the webhook is authoritative, and both funnel into
   * the same idempotent command so whichever arrives first wins.
   *
   * It exists so the app can show a confirmed screen immediately rather than
   * polling for a webhook the driver cannot see.
   */
  @Post('verify')
  async verify(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<PaymentResult> {
    const input = verifyPaymentSchema.parse(body);

    // Proves the callback came from Checkout rather than a replayed URL. It
    // proves nothing about the amount — that is re-fetched from Razorpay inside
    // the command, and nothing in this body can influence it (R-SEC-09).
    this.verification.verifyCheckoutSignature(
      input.razorpayOrderId,
      input.razorpayPaymentId,
      input.razorpaySignature,
    );

    const payment = await this.payments.findByOrderId(input.razorpayOrderId);

    // Role guard ≠ ownership check (rule 7). A valid Checkout signature says
    // Razorpay issued this order; it does not say this driver owns it.
    if (payment === undefined || payment.userId !== user.id) throw new PaymentNotFoundError();

    const result = await this.confirmPayment.execute({
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      method: null,
    });

    if (result.outcome === 'unknown_order') throw new PaymentNotFoundError();

    /**
     * A car wash add-on does not belong on this route. §13.4 gives a wash its
     * own order and its own Checkout handoff
     * (`POST /driver/carwash/requests/:id/order`), and this response shape is
     * entirely about a booking: it reports a `bookingStatus`, and a wash never
     * moves one.
     *
     * The capture itself was committed by the command above, so the money is
     * safe either way — this refuses to *describe* it in booking terms rather
     * than refusing to record it.
     */
    if (result.outcome === 'carwash_captured') throw new PaymentNotFoundError();

    // 'orphaned' means the expiry job released the slot while the driver was
    // paying. The money is on its way back, and saying "confirmed" here would
    // send them to a booking that no longer exists.
    return {
      bookingId: result.bookingId,
      status: result.outcome === 'orphaned' ? 'refunded' : 'captured',
      bookingStatus: result.outcome === 'orphaned' ? 'cancelled' : 'confirmed',
    };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import type { CarwashServiceName, VehicleType } from '@parkease/contracts/enums';
import { washServices } from '@parkease/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';

export interface StandardService {
  readonly name: CarwashServiceName;
  readonly label: string;
  readonly carPaise: number;
  readonly bikePaise: number;
  readonly durationMin: number;
}

/**
 * The v1 catalogue, seeded onto every new partner. §13.3.
 *
 * A partner edits these prices; they cannot add a service outside the set,
 * which is why `wash_services.service_name` is a CHECK constraint rather than
 * free text. The defaults are a starting point a partner can ignore — what they
 * buy is a menu that is complete from the first minute, so a partner who
 * registers and goes online is immediately eligible for every service they
 * ticked rather than invisible until they fill a price form in.
 */
export const STANDARD_SERVICES: readonly StandardService[] = [
  {
    name: 'basic_exterior',
    label: 'Basic Exterior Wash',
    carPaise: 19900,
    bikePaise: 9900,
    durationMin: 20,
  },
  {
    name: 'premium_wash',
    label: 'Premium Wash',
    carPaise: 39900,
    bikePaise: 14900,
    durationMin: 40,
  },
  {
    name: 'interior_only',
    label: 'Interior Only',
    carPaise: 29900,
    bikePaise: 9900,
    durationMin: 30,
  },
  {
    name: 'full_detailing',
    label: 'Full Detailing',
    carPaise: 79900,
    bikePaise: 29900,
    durationMin: 60,
  },
  { name: 'quick_wipe', label: 'Quick Wipe', carPaise: 9900, bikePaise: 4900, durationMin: 10 },
];

export const SERVICE_LABELS: Readonly<Record<CarwashServiceName, string>> = Object.fromEntries(
  STANDARD_SERVICES.map((s) => [s.name, s.label]),
) as Record<CarwashServiceName, string>;

export type WashServiceRow = typeof washServices.$inferSelect;

export interface UpsertServiceInput {
  readonly washerUserId: string;
  readonly serviceName: CarwashServiceName;
  readonly carPricePaise: number;
  readonly bikePricePaise: number;
  readonly durationMinutes: number;
  readonly isActive: boolean;
}

/**
 * A partner's price list: one service, two rows, one per vehicle type.
 *
 * Every method here takes the partner's own user id and filters on it in SQL. A
 * menu is not secret, but it is theirs, and a method that could read or write
 * somebody else's by accident is one refactor away from doing it.
 */
@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The standard menu, on a brand-new partner.
   *
   * A plain INSERT, and a conflict fails loudly on `wash_services_menu_key`.
   * This runs inside registration's transaction so a partner never exists
   * without a menu, and a retried registration never gets here twice: the
   * idempotency layer replays it, and `CreateWasherProfileCommand`'s existence
   * check (or, racing it, `washer_profiles_user_id_key`) refuses a new key. A
   * second seed is therefore a bug, and the target-less `onConflictDoNothing()`
   * that used to absorb it silently kept the first menu's `is_active` flags —
   * contradicting the capabilities just sent (database L8).
   *
   * Every service is PRICED, and only the ones the partner said they offer are
   * switched on (ruling T10-S1). The menu is what dispatch reads, so an active
   * row for a service they did not tick would send them jobs they said they do
   * not do; a missing row would make switching it on later a re-pricing
   * exercise instead of a toggle.
   */
  async seedMenu(
    tx: TxHandle,
    washerUserId: string,
    offered: readonly CarwashServiceName[],
  ): Promise<void> {
    const rows = STANDARD_SERVICES.flatMap((service) => {
      const isActive = offered.includes(service.name);
      return [
        {
          washerUserId,
          serviceName: service.name,
          vehicleType: 'car',
          pricePaise: service.carPaise,
          durationMinutes: service.durationMin,
          isActive,
        },
        {
          washerUserId,
          serviceName: service.name,
          vehicleType: 'two_wheeler',
          pricePaise: service.bikePaise,
          durationMinutes: service.durationMin,
          isActive,
        },
      ];
    });

    await tx.insert(washServices).values(rows);
  }

  async menuFor(washerUserId: string): Promise<WashServiceRow[]> {
    return this.db
      .select()
      .from(washServices)
      .where(eq(washServices.washerUserId, washerUserId))
      .orderBy(asc(washServices.serviceName), asc(washServices.vehicleType));
  }

  /**
   * What this partner charges for this service and vehicle type, right now.
   *
   * `undefined` for a missing row *and* for a deactivated one, deliberately:
   * both mean "not offering this", and the accept path has one answer for both.
   * A deactivated row is not a cheaper row, it is no row.
   */
  async findServicePrice(
    washerUserId: string,
    serviceName: CarwashServiceName,
    vehicleType: VehicleType,
  ): Promise<WashServiceRow | undefined> {
    const [row] = await this.db
      .select()
      .from(washServices)
      .where(
        and(
          eq(washServices.washerUserId, washerUserId),
          eq(washServices.serviceName, serviceName),
          eq(washServices.vehicleType, vehicleType),
          eq(washServices.isActive, true),
        ),
      );

    return row;
  }

  /**
   * One edit, both rows, one statement.
   *
   * The two rows move together or not at all — a partner who sets a car price
   * and whose bike price silently keeps yesterday's value has a menu that lies.
   * A single multi-row upsert against the menu unique key gets that from
   * Postgres rather than from two statements and a transaction wrapped around
   * a hope.
   */
  async upsertService(input: UpsertServiceInput): Promise<WashServiceRow[]> {
    const rows = [
      {
        washerUserId: input.washerUserId,
        serviceName: input.serviceName,
        vehicleType: 'car',
        pricePaise: input.carPricePaise,
        durationMinutes: input.durationMinutes,
        isActive: input.isActive,
      },
      {
        washerUserId: input.washerUserId,
        serviceName: input.serviceName,
        vehicleType: 'two_wheeler',
        pricePaise: input.bikePricePaise,
        durationMinutes: input.durationMinutes,
        isActive: input.isActive,
      },
    ];

    return this.db
      .insert(washServices)
      .values(rows)
      .onConflictDoUpdate({
        target: [washServices.washerUserId, washServices.serviceName, washServices.vehicleType],
        set: {
          pricePaise: sql`excluded.price_paise`,
          durationMinutes: sql`excluded.duration_minutes`,
          isActive: sql`excluded.is_active`,
          updatedAt: new Date(),
        },
      })
      .returning();
  }
}

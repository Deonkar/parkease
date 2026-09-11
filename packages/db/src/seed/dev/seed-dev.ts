import process from 'node:process';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { uuidv7 } from '../../id.js';
import { bookings } from '../../schema/booking.js';
import { users, userRoles } from '../../schema/identity.js';
import { ledgerEntries } from '../../schema/ledger.js';
import { spaces, spaceSlots } from '../../schema/space.js';

import { BANGALORE_FIXTURES, SEED_USERS } from './fixtures.js';

function getDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

async function seedDev(): Promise<void> {
  const sql = postgres(getDatabaseUrl());
  const db = drizzle(sql);

  try {
    await db.transaction(async (tx) => {
      const userIds: Record<string, string> = {};

      for (const [key, userData] of Object.entries(SEED_USERS)) {
        const [user] = await tx
          .insert(users)
          .values({
            phone: userData.phone,
            name: userData.name,
            firebaseUid: userData.firebaseUid,
            status: 'active',
          })
          .onConflictDoUpdate({
            target: users.phone,
            set: { name: userData.name, updatedAt: new Date() },
          })
          .returning({ id: users.id });

        if (!user) throw new Error(`Failed to upsert user: ${key}`);
        userIds[key] = user.id;
      }

      const driverId = userIds['driver'];
      const ownerDriverId = userIds['ownerDriver'];
      const valetId = userIds['valet'];
      const washerId = userIds['washer'];
      if (!driverId || !ownerDriverId || !valetId || !washerId) {
        throw new Error('Missing user IDs after seeding');
      }

      const roleGrants: Array<{ userId: string; role: string; status: string }> = [
        { userId: driverId, role: 'driver', status: 'active' },
        { userId: ownerDriverId, role: 'owner', status: 'active' },
        { userId: ownerDriverId, role: 'driver', status: 'active' },
        { userId: valetId, role: 'valet', status: 'pending' },
        { userId: washerId, role: 'washer', status: 'active' },
      ];

      for (const grant of roleGrants) {
        await tx
          .insert(userRoles)
          .values({
            userId: grant.userId,
            role: grant.role,
            status: grant.status,
            verifiedAt: grant.status === 'active' ? new Date() : null,
          })
          .onConflictDoNothing({ target: [userRoles.userId, userRoles.role] });
      }

      const spaceIds: string[] = [];
      for (const fixture of BANGALORE_FIXTURES) {
        const schedule: Record<string, { open: string; close: string }> = {};
        for (const day of [
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
        ]) {
          schedule[day] = { open: '06:00', close: '22:00' };
        }

        const [space] = await tx
          .insert(spaces)
          .values({
            ownerId: ownerDriverId,
            title: fixture.title,
            addressLine: fixture.addressLine,
            city: fixture.city,
            state: fixture.state,
            pincode: fixture.pincode,
            location: { lng: fixture.location.lng, lat: fixture.location.lat },
            zoneId: `tdr0p${String(spaceIds.length)}`,
            approvalStatus: 'active',
            approvedAt: new Date(),
            schedule,
          })
          .onConflictDoNothing()
          .returning({ id: spaces.id });

        if (!space) {
          const [existing] = await tx
            .select({ id: spaces.id })
            .from(spaces)
            .where(eq(spaces.title, fixture.title));
          if (existing) spaceIds.push(existing.id);
          continue;
        }
        spaceIds.push(space.id);

        const slotsEntries = Object.entries(fixture.slots) as Array<[string, number]>;
        for (const [vType, slotCount] of slotsEntries) {
          const priceKey = vType as keyof typeof fixture.pricePaiseHourly;
          const price = fixture.pricePaiseHourly[priceKey];

          for (let i = 0; i < slotCount; i++) {
            await tx
              .insert(spaceSlots)
              .values({
                spaceId: space.id,
                vehicleType: vType,
                slotIndex: i,
                pricePaiseHourly: price,
              })
              .onConflictDoNothing();
          }
        }
      }

      const firstSpaceId = spaceIds[0];
      if (firstSpaceId) {
        const now = new Date();
        const startsAt = new Date(now.getTime() + 3600_000);
        const endsAt = new Date(now.getTime() + 7200_000);

        const basePaise = 6000;
        const surgePremiumPaise = 0;
        const parkeaseFeePaise = 900;
        const gstPaise = 162;
        const totalPaise = basePaise + surgePremiumPaise + gstPaise;
        const ownerEarningsPaise = basePaise - 900;

        const [booking] = await tx
          .insert(bookings)
          .values({
            driverId,
            spaceId: firstSpaceId,
            vehicleType: 'car',
            durationType: 'hourly',
            startsAt,
            endsAt,
            status: 'confirmed',
            basePaise,
            surgePremiumPaise,
            surgeMultiplierBp: 10_000,
            parkeaseFeePaise,
            gstPaise,
            totalPaise,
            ownerEarningsPaise,
          })
          .returning({ id: bookings.id });

        if (booking) {
          const txnId = uuidv7();

          await tx.insert(ledgerEntries).values([
            {
              txnId,
              account: 'driver_receivable',
              direction: 'debit',
              amountPaise: totalPaise,
              bookingId: booking.id,
              counterpartyUserId: driverId,
              description: 'Booking payment received',
            },
            {
              txnId,
              account: 'owner_payable',
              direction: 'credit',
              amountPaise: ownerEarningsPaise,
              bookingId: booking.id,
              counterpartyUserId: ownerDriverId,
              description: 'Owner earnings for booking',
            },
            {
              txnId,
              account: 'platform_revenue',
              direction: 'credit',
              amountPaise: parkeaseFeePaise,
              bookingId: booking.id,
              description: 'ParkEase fee (15% of base)',
            },
            {
              txnId,
              account: 'gst_payable',
              direction: 'credit',
              amountPaise: gstPaise,
              bookingId: booking.id,
              description: 'GST on ParkEase fee',
            },
          ]);
        }
      }

      // eslint-disable-next-line no-console -- seed script output
      console.info('seed-dev: seeded 3 Bangalore spaces, users, booking, and ledger entries');
    });
  } finally {
    await sql.end();
  }
}

seedDev().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- top-level error reporting
  console.error('seed-dev failed:', err);
  process.exit(1);
});

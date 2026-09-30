---
title: "One booking. Three answers. Only one was true."
published: false
tags: postgres, typescript, nestjs, showdev
series: "Building ParkEase"
cover_image:
---

![One booking, three answers: ₹82.47, ₹51.00, ₹42.50. Two get struck through.](./engineering/brag.gif)

{% youtube 4eCw2jclaYM %}

A parking space owner opens their app and sees **₹82.47**.

They tap Earnings. It says **₹51.00**.

Payday comes. **₹42.50** lands.

Same booking. Same owner. Three different numbers, and every one of them came from code that looked correct.

That was version one of ParkEase, the peer-to-peer parking marketplace I'm building for India. People with an empty driveway or basement slot list it; drivers find it on a map and book it by the hour. And we're close to launch. Close enough that "which number is real?" had to become a question the app can't even ask.

This is how.

## Three careful people, three wrong answers

Nobody wrote a bug on purpose. Three parts of the app each answered "how much did this owner earn?":

- The **dashboard** took 85% of the booking total.
- The **earnings screen** summed the owner's account in the ledger.
- The **payout job** subtracted a recomputed fee from the base price.

Each formula is locally reasonable. Put a surged booking through all three and they split three ways. The dashboard counted surge as the owner's money (it isn't), and the payout job lost the surge allocation entirely.

Only one of them was reading the truth: the ledger. So the fix wasn't a fourth formula. It was deleting two.

## Every figure is one query

Now there is one question, asked one way. Owed, today, this month, last month: all four are the same function over the ledger, scoped to a different period:

<!-- apps/api/src/domains/ledger/queries/owner-dashboard.ts:39-50,85-88 @ fca625c -->
```ts
async forOwner(ownerId: string): Promise<OwnerDashboardData> {
  return this.db.transaction(
    async (tx) => {
      // …
      const owed = await this.balance.movement(ownerId, undefined, tx);
      const today = await this.balance.movement(ownerId, periodBound(at, 'today'), tx);
      const month = await this.balance.movement(ownerId, periodBound(at, 'month'), tx);
      const lastMonth = await this.balance.movement(ownerId, lastMonthToDate(at), tx);
      // …
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
```

And `movement()` is nothing clever. It's a sum over the owner's side of a double-entry ledger, in integer paise, so there is no floating point anywhere near money:

<!-- apps/api/src/domains/ledger/queries/owner-balance.ts:33-36 @ fca625c -->
```ts
const CREDITS = sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
  filter (where ${ledgerEntries.direction} = 'credit'), 0)::text`;
const DEBITS = sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
  filter (where ${ledgerEntries.direction} = 'debit'), 0)::text`;
```

<!-- apps/api/src/domains/ledger/queries/owner-balance.ts:161-176 @ fca625c -->
```ts
async movement(
  ownerId: string,
  bound: SQL | undefined,
  reader: Reader = this.db,
): Promise<Movement> {
  const [row] = await reader
    .select({ creditsPaise: CREDITS, debitsPaise: DEBITS })
    .from(ledgerEntries)
    .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .where(and(this.ownerScope(ownerId), bound));

  const creditsPaise = Number(row?.creditsPaise ?? 0);
  const debitsPaise = Number(row?.debitsPaise ?? 0);
  return { creditsPaise, debitsPaise, netPaise: net(debitsPaise, creditsPaise) };
}
```

## The detail that's easy to miss

Look at the last line of that transaction: `repeatable read`, `read only`.

Those four `movement()` calls are four separate `SELECT`s. Without one snapshot, a booking that settles between the "today" read and the "month" read could make **today bigger than this month** for one page load. Rare? Yes. The kind of thing an owner screenshots and sends to support? Also yes. One read-only snapshot means all four numbers see the same instant.

## Surge never touches the owner's line

The platform takes one fee: 15% of the base price plus all of the surge. So an owner's earnings are always base minus 15%, whatever demand did that evening. The rate lives in exactly one dated table:

<!-- packages/contracts/src/money/rates.ts:19-25 @ fca625c -->
```ts
export const PLATFORM_COMMISSION_RATE_HISTORY: readonly DatedRate[] = [
  {
    rate: toRate(0.15),
    effectiveFrom: '2026-01-01',
    note: 'Launch rate. 15% of base, charged once, deducted from the owner payout.',
  },
];
```

## Don't trust me. Trust the test.

"They use the same function" is a claim. This test turns it into a fact. It goes through the real HTTP stack, against a real Postgres in a throwaway container, books twice, and asks both screens:

<!-- apps/api/test/integration/owner-dashboard-http.spec.ts:61-77 @ fca625c -->
```ts
it('dashboard and earnings agree on owner earnings', async () => {
  const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
  await bookConfirmed(spaceId, 2);
  await bookConfirmed(spaceId, 6);

  const dashboard = (await get('/owner/dashboard')).body as {
    data: { month: { netPaise: number }; owedPaise: number; statement: unknown[] };
  };
  const earnings = (await get('/owner/earnings?period=month')).body as {
    data: { netPaise: number; bookings: number };
  };

  expect(dashboard.data.month.netPaise).toBe(earnings.data.netPaise);
  expect(dashboard.data.owedPaise).toBe(earnings.data.netPaise);
  expect(earnings.data.bookings).toBe(2);
  expect(dashboard.data.statement).toHaveLength(2);
});
```

All 10 tests in that file pass. One of them pins the other half of the rule: a surged booking shows the owner base, fee and net, with no surge, no GST and no booking total.

## The lesson I paid for

If a user can put two numbers side by side, they must come from **the same function**. Not the same formula, copied carefully. The same function.

---

**Tomorrow:** you've seen the machinery. Tomorrow you see what it's for: what a parking space owner actually does in ParkEase, from an empty driveway to a driver pulling up at the gate and the moment their phone says *checked in*. Five things. Under thirty seconds. Follow the series so you don't miss it.

*ParkEase is a peer-to-peer parking marketplace for India, built solo and launching soon on Android.*
*Code: https://github.com/Deonkar/parkease · Music: ende.app (CC BY 4.0)*

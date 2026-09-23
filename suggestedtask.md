# Suggested tasks

Work that was **found** during a task but deliberately **not done** in it, so the task
stayed the size it was scoped to be. This is the queue, not a wish list: every row is
something a real change surfaced, with enough context to act on without the conversation
that produced it.

**Read this at the start of Phase 2 (Plan).** If the task you are about to start would
naturally clear a row here, fold it in and say so. Picking up a row is otherwise its own
task, with its own gates.

**Add a row whenever you decide not to do something you noticed.** Silently dropping a
finding is how a review becomes theatre. A row costs a minute; a forgotten footgun costs a
production defect.

## How to use this file

| Field            | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| **Found in**     | The task or change that surfaced it — the audit trail                |
| **Why deferred** | The scope argument. If there isn't one, it should have been done     |
| **Done means**   | The check that closes the row, not a vague intention                 |
| **Status**       | `open` · `chip` (a background-task chip exists) · `blocked` · `done` |

Close a row by deleting it and noting the change in `learnings.md` or `docs/decisions.md`
if it taught something. A file of `done` rows is a file nobody reads.

---

## Open

### S-01 — Delete the dead `ValetJobOffer` contract

- **Status:** `chip` (spawned 2026-09-21)
- **Found in:** task 12, wiring the valet earnings display
- **Surface:** `packages/contracts`

`packages/contracts/src/valet/job-offer.ts` defines `valetJobOfferSchema` / `ValetJobOffer`
with a `feePaise` field — the **gross** fee the driver is charged. It is exported from the
barrel at `packages/contracts/src/valet/index.ts:1` and imported by nothing.

The real offer contract is `valetOfferSchema` in `job-view.ts`, whose `earningsPaise` is the
valet's **net**, computed server-side by `computeValetLegFee`.

This is a live footgun. `docs/tasks/task-12-valet-app.md` records that v1 shipped a bug
displaying `feePaise` as take-home — about 25% too high. A dead schema named like an offer,
whose only money field is the gross, invites exactly that mistake again.

- **Why deferred:** task 12 is a mobile task; this is a contracts-package deletion that
  needs its own verification sweep across all five apps.
- **Done means:** nothing imports it (checked across `apps/*` and `packages/*`, ignoring
  `packages/contracts/dist/`), the file and its barrel export are gone, and
  `pnpm turbo run lint typecheck test` is green.

### S-02 — Valet earnings cannot show the per-job fee breakdown the design asks for

- **Status:** `open`
- **Found in:** task 12, building the earnings screen
- **Surface:** api + mobile

`GET /valet/earnings` returns a summary only — `{grossPaise, reversedPaise, netPaise,
jobsCompleted}`. `docs/tasks/task-12-valet-app.md` §12.6 designs a per-job list showing
`Fare ₹90.00 / ParkEase fee (20%) −₹18.00 / You earned ₹72.00`, and argues for it well: _"a
partner who cannot audit their own pay stops trusting the number."_

That data is not derivable client-side. Computing the fee line in the app would put the
commission rate into `apps/mobile`, which R-FE-06 bans and a CI grep catches. The contract
also notes the omission of `commissionPaise` is **deliberate** — commission is credited to
`platform_revenue`, not to this account.

The valet earnings screen therefore ships showing the four ledger figures, honestly, with no
per-job list.

- **Why deferred:** serving it means a new API query and contract — task 11/16 territory,
  not a mobile task.
- **Done means:** an endpoint returns per-leg lines with gross and net **already computed
  server-side**, the mobile screen renders them with no arithmetic, and the R-FE-06 grep
  still returns nothing.

### S-03 — `EXPO_PUBLIC_API_URL` is unset for web, so API calls silently hit Metro

- **Status:** `open`
- **Found in:** task 12, verifying the valet screens at `:8099`
- **Surface:** mobile / tooling

With `EXPO_PUBLIC_API_URL` unset, `lib/api.ts` builds `baseURL` as the relative `/api/v1`.
In the web preview that resolves against the **Metro dev server**, and Metro answers unknown
paths with **`200 OK` and `text/html`** (the SPA shell).

So every API call in a web-preview session returns a successful-looking HTML document.
Requests appear green in the network panel while nothing real is being exercised. Zod
rejects the body, so it surfaces as an error state rather than fake data — but the
_diagnosis_ is badly misleading, and it cost time in this task.

- **Why deferred:** it is a verification-environment fix, not part of the valet feature.
- **Done means:** the `mobile-web` launch config (or a committed `.env` default) points
  `EXPO_PUBLIC_API_URL` at `http://localhost:3000`, and a request to an unknown API path in
  the web preview fails visibly instead of returning HTML with a 200.

### S-04 — Valet Maestro flows are written but cannot be run

- **Status:** `blocked` (needs two devices)
- **Found in:** task 12
- **Surface:** mobile / E2E

`valet-first-job.yaml` and `valet-verification-pending.yaml` need a valet device and a driver
device driving the same job, plus a running API. The agreed verification reach for task 12
was the web preview plus a device checklist, so they are unexecuted.

- **Done means:** both flows run green on a physical Android device against a live API, with
  the output pasted into the PR.

### S-05 — Google Play background-location declaration

- **Status:** `blocked` (gates release, not development)
- **Found in:** task 12
- **Surface:** release

`ACCESS_BACKGROUND_LOCATION` requires a Play Console declaration and a demo video showing the
in-app disclosure and the feature that needs it. It is the single most common reason a partner
app is rejected.

- **Why deferred:** it gates store submission, not the build. Belongs beside the other
  submission items.
- **Done means:** the declaration and video are submitted and accepted. Track alongside task 22.

### S-06 — Confirm the online switch's touch target on a real Android device

- **Status:** `open`
- **Found in:** task 12, auditing `OnlineStatusBar` in the web preview
- **Surface:** mobile / a11y

React Native's `Switch` renders **40×20 CSS px** under `react-native-web`, below the 48dp
Material minimum. On Android the native `SwitchCompat` supplies its own ≥48dp touch target, so
this is expected to be a web-rendering artifact rather than a real defect — but that has not
been confirmed on a device, and "expected to be" is not a verification.

- **Why deferred:** unverifiable in the browser, which is the whole point of the row.
- **Done means:** measured on the R-PERF-06 target device (Redmi 9A class); if the target is
  genuinely under 48dp, the switch gets a wrapper that provides one.

### S-07 — No test exercises `postFix`'s real request body

- **Status:** `open`
- **Found in:** task 12, test-adequacy review
- **Surface:** mobile

`location-queue.test.ts` drives the queue with a synthetic `send`, and `tracking.test.ts` drives
`flushQueue` through an injected fake. Neither ever calls the real `postFix`, so its actual
payload is unasserted — which is how it shipped with a flat `lat`/`lng` body against a contract
that takes a nested `location`, and with `isOnline: true` on a drain that could run after the
valet went offline. Both are fixed, neither is covered.

- **Why deferred:** it needs an axios-level test harness that `apps/mobile` does not have yet.
- **Done means:** a test mocks `api.patch` and asserts the body `postFix` sends parses against
  `setValetAvailabilitySchema`, with a drain during `stopTracking` never asserting `isOnline: true`
  after the offline PATCH.

### S-08 — Fixes are never delivered over the socket, only over REST

- **Status:** `open`
- **Found in:** task 12
- **Surface:** mobile + api

`docs/tasks/task-12-valet-app.md` §12.5 describes the queue draining "over the socket when it is
connected, and over REST when it is not". Only the REST path is built: `lib/socket.ts` exists and
the `/valet-tracking` namespace accepts `valet:location`, but nothing in the valet app emits a fix
over it. The code comment claiming a socket preference has been corrected rather than left to
mislead.

- **Why deferred:** REST delivery is correct and sufficient; the socket path is an optimisation,
  and building it half-tested is worse than not building it.
- **Done means:** the drain emits over the socket when connected and falls back to REST, with a
  test for each path and for the changeover.

### S-09 — The socket's token refresh races its own reconnect

- **Status:** `open`
- **Found in:** task 12, security review
- **Surface:** mobile

`apps/mobile/src/lib/socket.ts` handles `connect_error` by reading secure storage in an
unawaited async block and then assigning `socket.auth`. socket.io's own reconnection can fire
another attempt with the **old** token before that read resolves, because nothing blocks or
cancels the pending retry.

Not a leak — the token being retried is the same user's previous token, never another user's —
so this is robustness rather than security. The visible symptom is extra 401 round-trips and, if
the session is genuinely revoked, an indefinite retry loop that never surfaces a hard
"session invalid" state.

- **Why deferred:** the fix changes reconnection strategy (`reconnection: false` plus a manual
  `connect()` once the token is set), which wants its own test for the changeover and for the
  revoked-session terminal state. No valet screen subscribes to the socket yet, so nothing
  currently depends on this path.
- **Done means:** reconnection is deterministic after a refresh, and a repeatedly-rejected
  handshake ends in a surfaced "signed out" state rather than an unbounded retry.

### S-10 — `verificationStatus` is `z.string()` when the enum already exists

- **Status:** `open`
- **Found in:** task 12, quality review
- **Surface:** `packages/contracts`

`valetProfileViewSchema.verificationStatus` is `z.string()` (`job-view.ts`), even though
`packages/contracts/src/enums/verification-status.ts` already defines `verificationStatusSchema`
and `admin/verify-partner.ts` uses it. The mobile app's `describeVerification(status: string)`
and `documentStateFor(...)` inherit that wideness, so a typo in a case label would fall into the
default branch instead of failing typecheck.

No bug today: the default branch **fails closed**, which is the correct runtime behaviour for an
old app build meeting a new server value, and narrowing the type would add a compile-time check
on top of that guard rather than replacing it.

- **Why deferred:** `job-view.ts` shipped in task 11; changing it means re-verifying every
  consumer across five apps, which is not a mobile task.
- **Done means:** the contract reuses `verificationStatusSchema`, the mobile helpers take the
  narrowed type, and the fail-closed default is kept.

### S-11 — §12.7's availability settings have no API

- **Status:** `open`
- **Found in:** task 12, building the profile screen
- **Surface:** api + mobile

`docs/tasks/task-12-valet-app.md` §12.7 shows **Max job distance** and **Auto-offline after N
min idle** as editable settings. `valetProfileViewSchema` carries neither, and there is no
endpoint to write them. The profile screen ships without that section.

This matters beyond cosmetics: §12.3 says the offers list must not filter client-side because
the server's radius decided the offer set. Max job distance is the valet's half of that
contract, and right now they cannot set it at all.

- **Why deferred:** needs a contract, a column and an endpoint — task 11 territory.
- **Done means:** the profile screen writes both settings, and the _next_ offer set respects the
  distance server-side, asserted by a test.

### S-12 — A valet cannot upload documents from the app

- **Status:** `open`
- **Found in:** task 12, spec-conformance review
- **Surface:** mobile

`POST /valet/profile/documents` is live (`apps/api/src/roles/valet/profile.controller.ts`) and has
no mobile caller. An unverified valet therefore has no path to becoming verified from inside the
app: the verification banner's action now says so explicitly rather than rendering a button that
does nothing, but the capability is missing.

Uploading needs a document camera flow, Cloudinary **private delivery with signed URLs**
(`security.md` §5.1), and the rule that the Aadhaar _number_ is never collected — only the image,
viewed by an admin (§5.3). That is a task-sized piece of work, not a button.

- **Done means:** a valet can submit licence and identity documents, the images go to private
  Cloudinary delivery, and `verification_status` moves to `pending` without an admin touching the
  database.

### S-13 — Earnings has no period; the screen shows a lifetime total

- **Status:** `open`
- **Found in:** task 12, spec-conformance review
- **Surface:** api + mobile

§12.6 asks for Today / This week / This month with a payout date. Neither side supports a period:
`GET /valet/earnings` takes no query (`earnings.controller.ts`) and returns one lifetime summary.
Distinct from S-02, which is about per-job rows.

- **Done means:** the endpoint accepts a period, the screen offers the three ranges, and the
  weekly figure reconciles against a direct `owner_payable` balance query for the same window.

### S-14 — The active-job screen cannot identify the driver or reach support

- **Status:** `open`
- **Found in:** task 12, spec-conformance review
- **Surface:** api + mobile

§12.4 shows the driver's name, rating, vehicle and plate, plus **Contact Support**.
`valetJobViewSchema` carries none of it, so the valet meeting a stranger to take their car has no
way to confirm they have the right car or person, and no in-app escalation path.

- **Done means:** the job view carries enough to identify the vehicle, and support is reachable
  from the screen where something goes wrong.

### S-15 — The recorded fix failure is written and never read

- **Status:** `open`
- **Found in:** task 12, spec-conformance review
- **Surface:** mobile

`recordFixFailure` (`location/store.ts`) is written by the OS task; `readFixFailure` has no
caller. The store's own comment says the UI reads it to say _why_ the feed died — a revoked
permission and a lost satellite fix need different instructions, and today the banner
distinguishes only the permission case.

- **Done means:** the `lost` banner names the recorded reason, and the record is cleared when a
  fix arrives.

### S-16 — Offers renders one card, so R-FE-07's FlashList does not apply

- **Status:** `open` (decision to confirm, not a defect)
- **Found in:** task 12, spec-conformance review
- **Surface:** mobile

§12.3 specifies `FlashList`. Direction B — "Focus", which the user chose — renders exactly one
offer at a time with a position counter and a skip control, so there is no list to virtualise.
The offer set is paged in state, not rendered as rows.

This is a deliberate consequence of the chosen direction rather than an oversight, but it departs
from a written rule and should be confirmed rather than assumed.

- **Done means:** either the deviation is recorded (an ADR or a note in `rules.md` scoping R-FE-07
  to actual lists), or Offers grows a real list and Direction B is revisited.

### S-17 — The R-FE-06 money grep is not wired into CI

- **Status:** `open`
- **Found in:** task 12, spec-conformance review
- **Surface:** tooling

§12.6 marks `grep -rE "0\.2|VALET_COMMISSION|GST_RATE" apps/mobile/src/features/valet` as a **CI**
check. It is run by hand on every task and passes, but no workflow enforces it, so the guard
depends on someone remembering.

- **Done means:** a GitHub Actions step fails the build on a match.

### S-18 — The valet accept-timeout can overwrite an accept

- **Status:** `open`
- **Found in:** task 13, silent-failure review (the car wash twin was fixed in this task)
- **Surface:** worker

`apps/worker/src/jobs/valet/accept-timeout.job.ts` reads the job with a plain unlocked SELECT,
runs `findCandidates` (a PostGIS query on a cold index — real time), then writes with
`.where(eq(valetJobs.id, job.id))` in both the widening branch and `giveUp`. The status it read
is never pinned.

A valet accepting inside that window wins `AcceptJobCommand`'s conditional UPDATE — assignee,
distance, fee, `txn_id` and four ledger entries all committed — and the timeout's blind UPDATE
then puts the row back to `offered`, or to `cancelled` with `no_valet_available`, on top of it.
`valet_jobs_assignee_presence_check` catches the `offered` case loudly (the assignee is still
set, so the constraint fails and pg-boss retries into the guard). It does **not** catch the
`cancelled` case: that status is unconstrained, so the job is buried while the ledger says a
valet earned money for it, and the assigned valet is never told.

The car wash version of this was fixed in task 13 by pinning `status` (and the round) in the
UPDATE's WHERE and treating zero rows as the normal "somebody got there first" outcome.
`handlers.ts` also claims these handlers "take a row lock on valet_jobs"; there is no
`SELECT ... FOR UPDATE` anywhere in the file.

- **Why deferred:** task 11's code, and the fix wants its own regression test at the right seam —
  the guards catch a naively-staged accept, so a test that moves the row up front passes with or
  without the fix. The car wash tests show the shape that actually works.
- **Done means:** both valet branches pin the status, a mutation of either turns a test red, and
  the `handlers.ts` comment says what the code does.

### S-19 — `markRefunded` is an unchecked write next to a checked one

- **Status:** `open`
- **Found in:** task 13, silent-failure review
- **Surface:** api

`PaymentService.markRefunded` (`payment.service.ts`) is an `UPDATE ... WHERE id = ?` with no
`.returning()` and no row-count check. Both callers — `RefundService.refundForCancellation` and
task 13's `CancelWashCommand` — check `insertRefund` for `undefined` immediately before it and
throw loudly if the row was not created, citing R-FAIL-01 in a comment. The very next line
applies none of that scrutiny.

If it matches zero rows the `refunds` row still exists and the `payment.issue-refund` outbox
message still commits, so a refund is issued at the gateway against a payment whose local status
was never moved off `captured` — leaving it eligible to be refunded again by anything that keys
off `payments.status`.

- **Why deferred:** shared with the booking refund path that shipped in task 9, so the change
  needs its regression test there rather than in a car wash suite.
- **Done means:** `markRefunded` returns the updated row or throws, and a test proves a
  zero-match is loud.

### S-20 — `wash_job_offers` has no database guard against a self-offer

- **Status:** `open`
- **Found in:** task 13, database review
- **Surface:** database

`wash_jobs` carries `wash_jobs_washer_is_not_driver_check`, and the candidate query excludes the
driver from their own offer set. `wash_job_offers` has neither: nothing in the database stops a
direct write recording an offer whose `washer_user_id` is the job's own `driver_user_id`.

Not cheap to close — the guard needs a value from a different row (`wash_jobs.driver_user_id`),
which a plain CHECK cannot see, so it is a trigger rather than a constraint. `valet_job_offers`
has the identical gap.

- **Why deferred:** a trigger is a different class of object from everything else in these
  migrations, and it would be the first one in the schema that exists purely to re-state an
  application filter. Worth deciding deliberately rather than adding in passing.
- **Done means:** either the trigger exists on both offer tables, or an ADR records that the
  query-level exclusion plus the `wash_jobs` CHECK is the accepted depth.

### S-21 — `valet_job_offers_job_id_idx` duplicates a prefix of its unique key

- **Status:** `open`
- **Found in:** task 13, database review (the car wash twin was dropped in migration 0030)
- **Surface:** database

`valet_job_offers_job_valet_key` is `UNIQUE (job_id, valet_user_id)`, so Postgres already serves
`WHERE job_id = ?` from its leading column. `valet_job_offers_job_id_idx` adds a second B-tree to
maintain on every offer row written — five per job at valet's fan-out, on every dispatch and
every widened round — and covers no query the composite does not.

0030 dropped the car wash equivalent. The valet one was left alone because dropping an index on
a table task 11 ships against is a change that wants its own migration and its own verification.

- **Done means:** the index is dropped in its own migration, with `EXPLAIN` output on the offers
  lookup before and after showing the composite serving it.

### S-22 — The wash capture path has no end-to-end test

- **Status:** `open`
- **Found in:** task 13, building the Razorpay order path
- **Surface:** api

`ConfirmPaymentCommand` now branches on `payments.purpose` so a car wash capture marks the
payment captured and leaves the booking alone — without that branch a wash capture would have
been read as an orphan and auto-refunded. The branch is covered by typecheck and by reading, not
by a test: `carwash-http.spec.ts` stops at minting the order, because driving a capture needs the
Razorpay double and the webhook route wired into the car wash harness.

- **Why deferred:** the fixture is the work, not the assertion — `payment-webhook-http.spec.ts`
  already has the double and the signature machinery, and the honest fix is to extend that file
  with a wash payment rather than rebuild the harness in a car wash suite.
- **Done means:** a captured wash payment leaves `bookings.status` untouched, marks the payment
  `captured`, and posts no ledger entries — asserted over HTTP through the webhook route.

### S-23 — Business photos and operating hours have no reader

- **Status:** `open`
- **Found in:** task 13, at the user's request during design
- **Surface:** api + mobile + admin

`washer_profiles.business_photo_ids` and `operating_hours` are written at registration and
returned on the profile view. Nothing reads them: the driver's wash job view does not show a
partner's photos or hours, and task 18's admin verification screen does not exist yet.

They ship deliberately — the user asked for them during the design conversation rather than
deferring them — but they are inert until a consumer exists, and inert columns are how 0008
produced the shape 0027 had to clean up.

- **Done means:** either the task-14 driver view or the task-18 admin panel reads both, or a row
  here records the decision to drop them.

### S-24 — `max_distance_m` is still unimplemented for both partner types

- **Status:** `open` (extends S-11 to the washer side)
- **Found in:** task 13, schema design
- **Surface:** api + mobile

Task 13's column list includes `washer_profiles.max_distance_m`; 0027 does not add it, because
nothing in task 13 or 14 reads it and a nullable column nobody writes is exactly what 0027 was
cleaning up. S-11 records the identical gap for valet, where §12.7 shows the setting on a screen
that has no endpoint behind it.

The two should be decided together: the radius ladder is server-side for both partner types, so
"max job distance" is the partner's half of a contract the server currently owns entirely.

- **Done means:** either both partner types can set it and the next offer set respects it
  server-side, asserted by a test, or `rules.md` records that dispatch radius is not partner
  -configurable in v1 and both task files are corrected.

### S-25 — `pnpm audit` is red, and R-GIT-07 says it must be green

- **Status:** `open`
- **Found in:** task 13, the pre-PR gate
- **Surface:** tooling / dependencies

`pnpm audit` reports **62 vulnerabilities** (2 critical, 19 high, 35 moderate, 6 low), of which
**33 reach production dependencies** (16 high, 14 moderate, 3 low). R-GIT-07 lists a clean
`pnpm audit` as a condition of opening a PR, and this has not been true for at least task 12 —
`pnpm-lock.yaml` and every `package.json` are byte-identical to `main`, so task 13 introduced
none of it and could not have cleared it either.

The bulk is transitive and concentrated in a handful of roots, most of which are a version bump
rather than a migration: `undici` (several advisories, patched at 6.23 → 6.28 depending on the
finding), `@opentelemetry/*` (core, sdk-node, propagator-jaeger, exporter-prometheus,
auto-instrumentations-node), `sharp`, `tar-fs`, `postcss`, `image-size`, `decode-uri-component`
and `uuid`.

Recording it rather than fixing it inside task 13: a dependency sweep changes the lockfile under
five apps at once, and the honest way to do that is its own branch with the full suite run
afterwards — not a drive-by at the end of a feature. Doing it here would also mean a PR whose
diff is half car wash and half unrelated version bumps.

- **Why deferred:** pre-existing and orthogonal to this task; the fix is a lockfile change with
  a repo-wide blast radius.
- **Done means:** `pnpm audit --prod` is clean, `pnpm audit` has no critical or high, the full
  suite is green afterwards, and either CI enforces it or `rules.md` records the accepted
  residual with a reason per advisory.

### S-26 — No erasure path for partner and job personal data

- **Status:** `open`
- **Found in:** task 13, security gate (privacy pass)
- **Surface:** database + api

Task 13 adds personal data with no retention limit and no working deletion path:
`washer_profiles.id_document_id` (an identity document reference),
`business_photo_ids`, `current_location` (a partner's precise position), and
`wash_jobs.space_location` plus `before_photo_id` / `after_photo_id` — photographs of a
specific car, at a specific place, with a plate plausibly visible.

`washer_profiles` and `wash_services` cascade from `users`, so a user delete would clear
those. `wash_jobs.driver_user_id` and `washer_user_id` reference `users` **without** cascade,
and `ledger_entries` is append-only by trigger — so a delete fails on the foreign key and
there is no path that honours an erasure request at all. That is the correct answer for
financial records and the wrong one for the photo trail and the location history, which have
no reason to outlive the job.

Not task 13's invention: `valet_jobs.pickup_location`, `space_photos` and `valet_profiles`
have the same shape. But task 13 roughly doubles the surface and adds the first identity
document.

- **Why deferred:** an erasure design is a repo-wide decision — what is anonymised, what is
  retained for accounting, how long photos live in Cloudinary, and which of those is a legal
  obligation rather than a preference. That is an ADR, not an edit inside a feature branch.
- **Done means:** an ADR records the retention period for each class (proof photos, partner
  location, identity documents, ledger), a job enforces it, and a user deletion anonymises
  what it cannot remove instead of failing on a foreign key.

### S-29 — `proof.ts`'s compression constants are now unused

- **Status:** `open`
- **Found in:** task 14, task 1 (the shared signed-upload client)
- **Surface:** mobile

`apps/mobile/src/features/valet/proof.ts` exports `PROOF_MAX_BYTES`,
`PROOF_MAX_WIDTH` and `PROOF_QUALITY`, and its `submitProof` orchestration still
calls `deps.compress(uri, PROOF_MAX_WIDTH, PROOF_QUALITY)`. Task 1 moved the real
compression into `lib/uploads.ts` (`uploadImage` owns it now, called from
`uploadProof`) and made `useProofCapture.ts`'s `deps.compress` an identity
pass-through, specifically to avoid compressing the photo twice. That leaves
`PROOF_MAX_BYTES` unreferenced anywhere, and `PROOF_MAX_WIDTH` / `PROOF_QUALITY`
referenced only by `submitProof`'s call to an identity function that ignores
both arguments.

- **Why deferred:** `proof.ts` was outside task 1's file list (only
  `valet/api/valet.ts` and `valet/hooks/useProofCapture.ts` were in scope), and
  a grep found no other consumer of these three constants — but removing them,
  or restructuring `submitProof`'s compress-then-upload shape now that
  compression genuinely lives one layer up, is a design call for whichever task
  owns `proof.ts` next, not a drive-by edit from the task that stopped calling
  them.
- **Done means:** either `proof.ts` drops the now-dead constants and simplifies
  `submitProof` to no longer take a `compress` step, or a comment on
  `ProofDeps.compress` explains why an identity implementation is expected to
  stay valid there.

### S-30 — `carwash-http.spec.ts` seeds its space with a `slots` field `SeedSpaceOptions` does not have

- **Status:** `open`
- **Found in:** task 14 task-3 (earnings period filter and per-job lines)
- **Surface:** api (test)

`apps/api/test/integration/carwash-http.spec.ts`'s `beforeAll` calls
`seedSpace(h, { ..., slots: { car: 4 } })`, but `SeedSpaceOptions` in
`harness.ts` only has `carSlots?: number` and `twoWheelerSlots?: number` — there
is no `slots` field. `seedSpace` silently ignores the unknown property and
falls back to its default of one car slot. Vitest transpiles test files without
a type check, so this compiles and runs without ever erroring; the suite
happens to pass because none of its tests need more than one live car slot at
once. Writing `washer-earnings-http.spec.ts` for task-3 needed the same fixture
and used the correct field name (`carSlots: 4`) rather than copy the mistake.

- **Why deferred:** out of scope for task-3, which only reads
  `carwash-http.spec.ts` for its fixture pattern — it does not touch that file.
  The fix is a one-line rename with no behavioural risk, but it belongs to
  whoever next touches that spec, or a drive-by hygiene pass.
- **Done means:** `slots: { car: 4 }` becomes `carSlots: 4` in
  `carwash-http.spec.ts`, and ideally `tsconfig` for `apps/api/test` is checked
  by `tsc --noEmit` somewhere in CI so an excess-property typo like this one
  fails loud next time instead of silently seeding one slot.

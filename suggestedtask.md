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

### S-27 — Washer presence is foreground-only

- **Status:** `open`
- **Found in:** task 14 task-6 (the washer online switch and heartbeat); carried as a
  `ponytail:` comment in `apps/mobile/src/features/washer/presence.ts`
- **Surface:** mobile

The washer's heartbeat runs on JS timers, and Android stops those when the app is backgrounded.
A washer who switches to another app stops beating. They fall out of dispatch
`WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS` (90s, `packages/contracts/src/washer/dispatch.ts`)
later, while the switch they left still reads **Online**. The offers screen's empty state tells
them to keep ParkEase open, but that is copy, not a fix. Valet already solves this with an
`expo-task-manager` background location task (`apps/mobile/src/features/valet/location/task.ts`).

- **Why deferred:** the fix needs a background task, a foreground-service notification, and
  the Play background-location declaration that S-05 already tracks for valet. That is a
  platform change, not screen work, and task 14 was scoped to the screens.
- **Done means:** washer presence beats from an `expo-task-manager` background task, as valet
  does, and `startPresence`'s API is unchanged. A test shows a backgrounded washer still posts a
  heartbeat inside the window.

### S-28 — `active/[jobId]` as a deep-link route

- **Status:** `open`
- **Found in:** task 14 design spec §5; task 7 deleted the route
- **Surface:** mobile

Task 14 removed `app/(washer)/active/[jobId].tsx`. `GET /washer/jobs/active` returns the one
live job a partner can hold, so `active/index.tsx` never needs an id. That stops being true only
if something outside the app has to open a _specific_ job. For example, a push notification
("your customer cancelled") would need to land on that job even when it is no longer the live
one.

- **Why deferred:** nothing targets a job by id today, so the route would have no caller.
- **Done means:** when push (or any other deep link) needs to target a specific job, an
  `active/[jobId]` route reads that job by id through an ownership-checked endpoint, and a
  Maestro or unit test opens it from a link.

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

- **Why deferred:** out of scope for task-3. Task-3 does edit
  `carwash-http.spec.ts`, but only its earnings assertion — first for the new
  response shape, then to request `?period=all` so it keeps its lifetime meaning
  — and not its `beforeAll` fixture. The fix is a one-line rename with no
  behavioural risk, but it belongs to whoever next touches that spec's fixtures,
  or a drive-by hygiene pass.
- **Done means:** `slots: { car: 4 }` becomes `carSlots: 4` in
  `carwash-http.spec.ts`, and ideally `tsconfig` for `apps/api/test` is checked
  by `tsc --noEmit` somewhere in CI so an excess-property typo like this one
  fails loud next time instead of silently seeding one slot.

### S-31 — `GET /washer/earnings?period=all` is unbounded

- **Status:** `open`
- **Found in:** task 14 task-3 review (earnings period filter and per-job lines)
- **Surface:** api

`WasherEarningsQuery.forWasher` (`apps/api/src/domains/carwash/queries/washer-earnings.query.ts`)
returns every completed job as a line for `period=all`, and each line runs two correlated
subqueries against `ledger_entries` (the `platform_revenue` fee and the `owner_payable` net on
the job's `txn_id`). There is no limit and no pagination.

- **Why deferred:** fine at current scale — `ledger_entries_txn_id_idx` makes each subquery an
  index lookup, and no partner has a lifetime job count that makes this measurable. Paginating
  now would change the response contract (a cursor in `meta`) for a problem nobody has.
- **Done means:** when a partner's lifetime job count makes `period=all` slow (measure it —
  `EXPLAIN ANALYZE` on a seeded partner with a realistic history), the lines become cursor
  paginated by `completed_at, id`, or the two subqueries become one grouped join, and the
  summary stays a single aggregate.

### S-32 — Nothing requires `completed_at` on a completed wash job

- **Status:** `open`
- **Found in:** task 14 task-3 review (earnings period filter and per-job lines)
- **Surface:** database

Migration 0030's `wash_jobs_assignee_presence_check` makes `price_paise` and `txn_id` NOT NULL
once a job is accepted, but no CHECK ties `completed_at` to `status = 'completed'`. The earnings
query used to paper over that with a 1970 fallback; it now passes the raw value, so a completed
row with a null `completed_at` fails the response parse loudly instead — which is the right
failure, but the database should make the row impossible.

- **Why deferred:** a schema change is a migration with its own review gate
  (`postgres-migration-reviewer`, R-GIT-07), and task-3 is a read-path change with no migration.
- **Done means:** a migration adds
  `CHECK (status <> 'completed' OR completed_at IS NOT NULL)` to `wash_jobs` (as `NOT VALID`
  then `VALIDATE CONSTRAINT`), reviewed SAFE, with an integration test that a completed row
  without `completed_at` is refused.

### S-33 — A server-side response parse failure answers `400 VALIDATION_FAILED` (washer surface done)

- **Status:** `open` (the washer surface is done; the rest of the repo remains)
- **Found in:** task 14 task-3 review (earnings period filter and per-job lines)
- **Surface:** api

`apps/api/src/platform/http/exception.filter.ts` (`map()`, around line 106) maps ANY `ZodError`
to `400 VALIDATION_FAILED`. That is right for request validation, and wrong for a query or
command that parses its own RESPONSE through Zod (R-VAL-01) and finds the server built
something invalid — that is a server bug and should be a `500`, logged at error with the trace
id, not blamed on the caller. Task-3's review found exactly this: a negative period net failed
`washerEarningsViewSchema.parse` and the partner's default earnings screen answered 400.

**Done for the washer surface (task 14 final fix wave).** `parseOutgoing(schema, value, what)` in
`apps/api/src/platform/http/outgoing-contract.ts` parses an outgoing value and rethrows a failure
as `500 INTERNAL_ERROR` carrying the `ZodError` as its cause, logged at error with the trace id.
The earnings view, `washerCard()`, the washer profile view and the service menu (`toMenu`) use it;
`test/outgoing-contract.spec.ts` and two HTTP tests (a completed job with no posting, a washer
card with no name) prove the 500. **What remains** is every other role's outgoing parse — valet,
driver, owner and admin views still call `schema.parse()` on their responses and still answer
400 on a broken row.

- **Why deferred:** the remaining call sites are other roles' endpoints, outside task 14's files.
- **Done means:** every response parse in `apps/api/src` goes through `parseOutgoing` (a grep for
  `ViewSchema.parse(` / `Schema.parse(` on response values finds none), and one HTTP test per role
  proves a malformed response answers 500 while a malformed request still answers 400.

### S-34 — A wash offer carries no address and no duration, so the card cannot show either

- **Status:** `open`
- **Found in:** task 14 task-6 (washer offers screen)
- **Surface:** contracts, api, mobile

Direction "Bay" (spec §2, mockup B1) draws each offer with the space's address and the job's
duration. `washJobOfferSchema` (`packages/contracts/src/washer/job-offer.ts`) has neither: only
`spaceLocation` (a point), `distanceM`, `serviceName`, `vehicleType` and `earningsPaise`. The
card ships without an address line, and takes its duration chip from the partner's OWN menu row
for that service and vehicle (`useServiceMenu`), which is the row the server priced the earnings
from, so the number is the partner's own quote; it is dropped when the menu has no row.

- **Why deferred:** adding fields to the offer is a contract + candidate-query change on the
  server (task 13's surface), not a screen change; task 6 is mobile-only.
- **Done means:** `washJobOfferSchema` gains `spaceAddress` (and `durationMinutes` snapshotted
  from the priced menu row), the offers query selects them, `carwash-http.spec.ts` asserts both
  on `GET /washer/jobs/offers`, and `WashOfferCard` renders the address under the vehicle line
  and reads duration from the offer instead of the menu lookup in `app/(washer)/offers.tsx`.
  The active-job header (`app/(washer)/active/index.tsx`, task 7) has the same gap:
  `WashJobView` carries no address either, so it shows "Your active job" where mockup B2 names
  the space; the same change should add `spaceAddress` to the job view.

### S-35 — Shared client error matching expects a `NOT_FOUND` code the API never sends

- **Status:** `open`
- **Found in:** task 14 task-6 review (CRITICAL 1, unregistered washer saw an error screen)
- **Surface:** mobile, api

`apps/api/src/platform/http/exception.filter.ts` (`errorCodeFor`, lines 58-65) builds
`error.code` from the `error` field of an HttpException's response. A bare
`new NotFoundException()` in Nest 11 carries no such field, so it answers code `'ERROR'`, never
`'NOT_FOUND'`. `apps/mobile/src/features/shared/hooks/useMessageForError.ts:26` matches
`case 'NOT_FOUND'`, which therefore never fires. Task 6 fixed the one place this broke a flow
(`GET /washer/profile` now throws `WasherProfileNotFoundError`), but bare
`new NotFoundException()` is still thrown in at least ten commands, including
`accept-wash.command.ts:48,51`, `advance-wash.command.ts:29`, `cancel-wash.command.ts:33`,
`create-wash-order.command.ts:55`, `request-carwash.command.ts:40`, the valet `accept-job` /
`advance-job` / `cancel-job` commands, and `roles/washer/jobs.controller.ts:136`.

The hook is also dead code, not only a matcher for a code that never arrives (task 14 task-11).
`useMessageForError.ts` exports `messageForError`, and nothing anywhere in `apps/` or
`packages/` imports it. Deleting the file is the smallest way to close its half of this row.
Wiring it into the screens that should use it is the other way.

- **Why deferred:** the fix spans the global filter or every command's 404, plus the shared
  client hook. That is cross-role, far outside one screen's fix round.
- **Done means:** shared error matching uses domain codes. Either every 404 the app routes on
  throws a domain error with a stable code, or the filter derives a code from the status when the
  response has no `error` field (e.g. 404 → `NOT_FOUND`). An HTTP test pins the code for a bare 404. `useMessageForError.ts` is either deleted or has callers and matches only codes the API
  actually emits.

### S-36 — The step rail advances without its `spring.gentle` motion

- **Status:** `open`
- **Found in:** task 14 task-7 (washer active-job screen)
- **Surface:** mobile

Spec §2 gives the evidence pair's slot fill `duration.base` + `easing.decelerate` and the step
rail's advance `spring.gentle`. The slot fill ships (`EvidencePair.tsx`, asserted by test);
`StepRail.tsx` changes marker state with no motion. The controller ruling for task 7 allowed
"the tokens' motion or no animation", and a rail that snaps is honest — but it is not yet what
the direction specified.

- **Why deferred:** the marker's ring-to-check change needs a Reanimated shared value driven by
  `withSpring(…, spring.gentle)`, plus a reduced-motion path, and nothing in the unit harness can
  see it — the only real check is on a device, which is task 11's pass.
- **Done means:** the current-step marker animates its fill with `spring.gentle` from
  `@parkease/tokens`, skipped under `useReducedMotion()`, checked on an Android device in the
  task-11 walkthrough.

### S-37 — Older literal opacities should use the new `opacity` token

- **Status:** `open`
- **Found in:** task 14 task-7 fix round 1 (minor 8 added `opacity` to `packages/tokens`)
- **Surface:** ui-native, mobile

`packages/tokens/src/opacity.ts` now defines `opacity.dimmed` (0.5) and `opacity.muted` (0.7),
and `EvidencePair` uses `opacity.dimmed`. Four literals predate it: `packages/ui-native/src/Button.tsx:69`
(`0.5`, disabled) and `:76` (`0.7`, disabled label), `apps/mobile/app/(auth)/choose-role.tsx:140`
(`0.5`) and `apps/mobile/src/features/driver/components/PhotoCarousel.tsx:92` (`0.5`, inactive dot).

- **Why deferred:** three surfaces outside the washer screen, one of them the shared Button
  every app renders — a visual change that deserves its own look on a device, not a rider on a
  fix round.
- **Done means:** the four literals read `opacity.dimmed` / `opacity.muted`, and
  `grep -rnE "opacity: 0\.[0-9]" apps/mobile packages/ui-native/src` returns nothing.

### S-38 — Two copies of the camera modal and the capture hook

- **Status:** `open`
- **Found in:** task 14 task-7 (washer active-job screen), fix round 1
- **Surface:** mobile

`features/washer/components/WashCamera.tsx` copies valet's `ProofCapture` camera modal, and
`features/washer/hooks/usePhotoSlot.ts` copies the shape of `features/valet/hooks/useProofCapture.ts`
(held uri, one attach intent per capture, held upload id, retry). R-ARCH-01 forbade the washer
importing from valet, so they were copied. Fix round 1 then had to change BOTH capture hooks
together for ruling T7-I1 — which is R-ARCH-07's test for extraction: call sites that must
change together.

- **Why deferred:** extracting touches the valet active screen, which task 7 does not own, and
  the two hooks attach through different endpoints and error vocabularies, so the shared seam
  (`attach(photoId, intent)` injected) needs its own design pass.
- **Done means:** `features/shared/components/CameraSheet.tsx` and
  `features/shared/hooks/usePhotoCapture.ts` (attach injected) back both roles; the valet and
  washer copies are deleted; `proof-upload.test.tsx` and `photo-slot.test.tsx` run against the
  shared hook.
- **Grown in task 14 task-10:** the camera-permission flow now has a third copy. The washer
  registration and profile screens share `features/washer/hooks/useCameraGate.ts` (extracted on
  its second use), and `WashCamera` is generic over its slot name; the washer active screen still
  carries its own inline permission code. The shared `CameraSheet` should take over all three.

### S-39 — Framed slots, the dashed cue and the switch off-track sit under the 3:1 non-text floor

- **Status:** `open`
- **Found in:** task 14 task-8 (service menu editor), design audit; widened in fix round 1
- **Surface:** mobile, tokens

WCAG 1.4.11 asks 3:1 for the visual information needed to identify a component or its state.
Measured with the `mobile-app-design` contrast script:

| Boundary                                                                                                                  | Token                                               | Against                      | Ratio  |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------- | ------ |
| Resting price slot (`ServiceRow` `slot`)                                                                                  | `colors.border` `#E2E8F0`                           | white card                   | 1.23:1 |
| same, against its own fill                                                                                                | `colors.border`                                     | `surfaceSecondary` `#F8FAFC` | 1.18:1 |
| Dashed "set your prices" cue (`ServiceRow` `slotEmpty`) and the evidence pair's empty frame (`EvidencePair` `frameEmpty`) | `colors.borderStrong` `#CBD5E1`                     | white                        | 1.48:1 |
| Switch off-track, white thumb on a white card                                                                             | `colors.borderStrong` track, `colors.surface` thumb | white                        | 1.48:1 |

The switch pattern is shared: `ServiceRow`, the washer `OnlineRail` and valet's
`OnlineStatusBar` (twice) all pass `trackColor.false: colors.borderStrong`. Today the text beside
each carries identification and state (CAR / BIKE and ₹, "Needed to start", "Offered" /
"Not offered", "Online" / "Offline"), so nothing is unreadable, but the frames and the off switch
are faint in sunlight, which is the washer's working condition.

- **Why deferred:** the fix is a token decision (a `borderInput` and a `switchTrackOff` at ≥3:1,
  or darkening `borderStrong`) that moves every bordered control and every switch in the app,
  across three roles. The two washer components must change together to keep their rhyme. That
  wants its own look on a device, not a rider on the menu task.
- **Done means:** slot boundaries, the dashed cue and the switch off-track each measure ≥3:1
  against their surface, asserted in `packages/tokens/test/contrast.spec.ts`; `ServiceRow`,
  `EvidencePair`, `OnlineRail` and `OnlineStatusBar` use the new tokens.

### S-40 — The earnings sparkline needs daily buckets from the API

- **Status:** `open`
- **Found in:** task 14 design spec §4.3 / §9; written when task-9 built the earnings screen
- **Surface:** api, contracts, mobile

The task file's §14.6 wireframe draws a five-bar week sparkline (`M T W T F`) under the earnings
headline. `GET /washer/earnings` returns a period summary and per-job lines, so sizing a bar
per day would mean grouping lines by day and summing paise in `apps/mobile` — the arithmetic
R-FE-06 forbids — and the lines count by completion time while the summary counts by posting
time, so client-summed bars would not even agree with the headline above them.

- **Why deferred:** it is the least load-bearing element on the screen, and the only honest
  version needs a contract change.
- **Done means:** the earnings response carries server-computed daily buckets for the period
  (IST days, `owner_payable` movement by `occurred_at`, the same basis as `summary.netPaise`),
  parsed by the contract, and the mobile sparkline renders them with no arithmetic beyond
  scaling bar heights to the largest bucket — with the bars labelled in text (R-FE-12).

### S-41 — `formatDateIST` renders "Sept" and no weekday

- **Status:** `open`
- **Found in:** task 14 task-9 (earnings screen)
- **Surface:** mobile

`apps/mobile/src/lib/format.ts` `formatDateIST` asks `toLocaleString('en-IN', { month: 'short' })`,
which Node's ICU renders as `Sept` for September (`12 Sept 2026`), not `Sep`. Hermes on
Android may or may not match, depending on its ICU build. The earnings line wanted a weekday
too ("Fri 12 Sep · 2:22 PM"), which the shared formatter does not produce.

- **Why deferred:** the task ruled "reuse, do not write new date formatting", and the formatter
  is app-wide (driver bookings, valet, washer) — changing its output is its own change with its
  own callers to check. `earnings-arithmetic.test.tsx` asserts through the formatter, not a
  pinned month spelling, so it holds either way.
- **Done means:** `formatDateIST` uses a fixed month table (`Jan`…`Dec`) so the output is
  identical on Node and Hermes, an optional weekday variant exists for list rows, and
  `format.test.ts` covers September.

### S-42 — The ID proof has one side; §14.2 draws a front and a back

- **Status:** `open`
- **Found in:** task 14 task-10 (washer registration), ruling T10-D1
- **Surface:** db, contracts, api, admin, mobile

§14.2's gig form draws "Upload front" and "Upload back". `submitWasherDocumentsSchema` has one
`idDocumentId`, `washer_profiles` one `id_document_id` column, and task 18's admin review is
single-document, so v1 collects ONE image, labelled for the side with the partner's photo.

- **Why deferred:** a second side is a migration, a contract field, an admin review change and a
  second capture — four surfaces for a task scoped to the mobile screens.
- **Done means:** a nullable `id_document_back_id` (or an array) through migration, contract,
  `POST /washer/profile/documents`, the admin review and the gig form; an admin can see both sides;
  existing single-image profiles stay valid.

### S-43 — Rename `washer_profiles.business_name` to `display_name` (expand-contract)

- **Status:** `open`
- **Found in:** task 14 task-10, rulings T10-D2 and T10-C2
- **Surface:** db, contracts, api, mobile

Ruling T10-C2 made `businessName` required for both partner types: it is the name a partner
trades under — a business's business name, a gig partner's OWN name — and `washerCard()` reads it
(`coalesce(business_name, users.name)`) as the name a driver sees. The column and field kept
their names to avoid a migration inside a mobile task, so a gig partner's personal name now sits
in a column called `business_name`, which misleads every future reader. Separately, nothing
writes `users.name` or `users.avatar_url` (no `PATCH /me`), which is why no gig profile photo is
collected in v1 (T10-D2).

- **Why deferred:** a column rename is an expand-contract migration across db, contracts, api and
  mobile, reviewed with `postgres-migration-reviewer`; out of scope for the registration screens.
- **Done means:** migration 1 adds `display_name` and backfills from `business_name`; writers
  write both; readers move to `display_name`; the contract field is renamed; migration 2 drops
  `business_name` and makes `display_name NOT NULL`. A `PATCH /me` for an avatar is its own row
  if still wanted.

### S-46 — `reversedPaise` will mislabel payouts once task 16 debits `owner_payable`

- **Status:** `open`
- **Found in:** task 14 task-3 / task-9 (earnings summary and screen)
- **Surface:** api, contracts, mobile

`washerEarningsSummarySchema.reversedPaise` (`packages/contracts/src/washer/job-view.ts`) is
documented as "what cancellations clawed back". The earnings query counts every debit to the
partner's `owner_payable` in the period. Today the only such debit is a cancellation reversal.
Task 16's payouts will also debit `owner_payable`, and from then on a payout counts as
`reversedPaise`. `EarningsSummary.tsx` would then tell a partner "After ₹X taken back for
cancelled washes" about money they were paid.

- **Why deferred:** payouts do not exist yet, so the figure is correct today. Splitting it now
  would mean guessing the payout's ledger shape before task 16 designs it.
- **Done means:** before task 16 ships, the earnings query separates payout debits from
  cancellation reversals, for example by `txn` kind or account pair. The contract carries a
  separate payouts figure (or excludes payouts from `reversedPaise`), and an integration test
  posts a payout and a cancellation in the same period and checks that each lands in its own
  figure.

### S-47 — Service prices: the DB CHECK is looser than the contract bound

- **Status:** `open`
- **Found in:** task 14 task-8 (service menu)
- **Surface:** database, contracts, mobile

The write contract bounds a service price to ₹10–₹9,999 (`MIN_SERVICE_PRICE_PAISE` /
`MAX_SERVICE_PRICE_PAISE`, `packages/contracts/src/washer/service-menu.ts`). The database check
is only `wash_services_price_check CHECK (price_paise > 0)` (`0008_services.sql`), and the read
schema accepts any positive price. A stored price outside the range can only get there from
outside the API: a seed, a manual fix, or a pre-bound row. Such a row cannot be toggled off
from the menu screen, because the toggle re-saves the server's prices through the bounded
write schema and the save fails validation.

- **Why deferred:** tightening a CHECK on a populated table needs an audit of existing rows
  first. It also needs a migration reviewed with `postgres-migration-reviewer` (`NOT VALID`,
  then `VALIDATE`), and task 8 was a mobile screen.
- **Done means:** existing rows are audited and any out-of-range rows are fixed. Then either a
  migration adds `CHECK (price_paise BETWEEN 1000 AND 999900)`, reviewed SAFE, or the toggle
  becomes a toggle-only write that does not re-send prices. A test covers the out-of-range row.

### S-48 — Valet screens keep stale data after a failed refresh with no notice

- **Status:** `open`
- **Found in:** task 14 task-7 review (ruling T7-I2, `resolveScreenState` returns `ready` for an
  errored query that still holds data)
- **Surface:** mobile

`apps/mobile/src/features/shared/screen-state.ts` now keeps a screen on its data when a refetch
fails. That is the right call, so a failed refresh no longer swaps a live job for an error
screen. The washer active, earnings, menu and profile screens pair it with a `RefreshNotice`
that says the latest refresh failed and offers another. Three screens do not: the valet active
screen (`app/(valet)/active/index.tsx`) and both offers feeds (`app/(valet)/offers.tsx`,
`app/(washer)/offers.tsx`). On those, a partner looks at data of unknown age with no sign that
it is stale.

- **Why deferred:** the valet screens were outside task 14's file list. The washer offers feed
  also polls every 15 seconds, so its window of stale data is short. A notice there is still
  owed.
- **Done means:** each of the three screens shows a refresh notice when `isError` is true and
  data is held. It uses a shared component (moved to `features/shared/` on this second role's
  use, R-ARCH-07), and a test per screen renders the stale-with-error state.

### S-49 — No endpoint writes a user's avatar

- **Status:** `open`
- **Found in:** task 14 task-10 (washer registration), ruling T10-D2; S-43 noted it
- **Surface:** api, contracts, mobile

`users.avatar_url` is read (`apps/api/src/domains/identity/repositories/user.repository.ts`) and
`cloudinary.service.ts` has an `avatars` folder, but no endpoint writes the column. The gig
registration's "profile photo" from §14.2 was therefore not built. Every role that shows a
face has the same gap.

- **Why deferred:** an avatar is a cross-role identity feature: one endpoint, one contract, and
  every role's profile screen. It does not belong to the washer registration screens.
- **Done means:** `PATCH /me` (or `PUT /me/avatar`) takes an upload id from the `avatars`
  folder, checked as S-50 describes, and writes `users.avatar_url`. The gig registration and
  profile screens collect and show it, and an HTTP test covers the write and its ownership
  check.

### S-50 — Upload ids are never checked for existence or ownership (security)

- **Status:** `open`
- **Found in:** task 14 task-11 review stack, security lens (the task-1 upload path and the
  task-7 / task-10 attach endpoints); corrected in the task 14 final fix wave
- **Surface:** api (washer, valet, owner)

`attachWashPhotoSchema.photoId`, `submitWasherDocumentsSchema.idDocumentId` /
`businessPhotoIds`, `createWasherProfileSchema.businessPhotoIds` and valet's `proofPhotoId`
are well-formed upload ids. Nothing checks two things: that the upload exists, and that it
belongs to the caller. Two consequences follow:

- A partner can reach `verification_status = 'pending'` with an id they made up.
- An evidence photo, the before/after pair whose value is that it can't be forged, can point
  at another user's upload in the same folder.

**Corrected.** This row used to say "the regex blocks URLs". That was true only of
`attachWashPhotoSchema`: the profile fields were `z.string().min(1).max(255)` and took a URL.
The task 14 final fix wave closed the URL and folder half: every field above now parses through
`uploadIdIn(folder)` (`packages/contracts/src/shared/upload-signature.ts`), which refuses a URL
and requires the `parkease/<folder>/` prefix the signer uses (`proofs`, `documents`, `spaces`).
What remains is existence and ownership, which a schema cannot know.

- **Why deferred:** the fix is a new record of issued upload signatures, and the washer, valet
  and owner attach paths would all have to check against it. That is a cross-role security
  change with its own migration, not a fix inside the mobile screens.
- **Done means:** the API records each signed upload (id, owner, folder) when it issues the
  signature. Every attach endpoint checks the id against that record, and rejects an unknown
  id or another user's id with a 4xx. An HTTP test covers each rejection.

### S-51 — Valet location heartbeat idempotency keys are not UUIDs

- **Status:** `chip`
- **Found in:** task 14 task-11 review stack (while reading `apps/mobile/src/features/valet/api/valet.ts`)
- **Surface:** mobile (valet), api

`postFix` in `apps/mobile/src/features/valet/api/valet.ts` sends
`Idempotency-Key: fix-<recordedAt>`. The server validates that header as a UUID and answers
`400`, so every valet location heartbeat is dropped, and valets fall out of dispatch while
their switch reads online. A separate background task has already been raised for it.

- **Why deferred:** it is valet code, outside task 14's file list, and it has its own task.
- **Done means:** that task lands. `postFix` sends a UUID key (one per fix, stable across that
  fix's retries), and an HTTP-level test posts a fix through the real idempotency guard and
  gets a 2xx.

### S-52 — The dev-mock preview does not reach washer registration or the gig ID upload

- **Status:** `open`
- **Found in:** task 14 task-11b (dev-mock fixtures, ruling T11-W1)
- **Surface:** mobile (washer)

Under a dev-mock session the washer fixtures serve a partner who is already **verified**,
so the walk-through covers offers, the active job, the menu, earnings and the profile, but
not `profile/register.tsx` or the gig partner's "send your ID" step. `createProfile` and
`submitDocuments` in `apps/mobile/src/features/washer/api/washer.ts` still go to the network,
and `useHeldUploads` / `useCameraGate` (registration photos) still call `uploadImage` and ask
for a real camera permission, which the browser preview refuses. On web that refusal is
silent, because react-native-web's `Alert.alert` is a no-op (`learnings.md`).

- **Why deferred:** the brief asked for a verified partner and the job walk; registration
  needs a second fixture mode (unregistered, then pending) and a way to pick it.
- **Done means:** a dev-mock session can start unregistered (404 `WASHER_PROFILE_NOT_FOUND`
  from the store), register as business and as gig, send an ID with the stand-in camera,
  and land in `pending`; `dev-fixtures.test.ts` walks it; nothing reaches the network.

### S-53 — `tabIcon` and the tab-bar sizing are copied into three role layouts

- **Status:** `open`
- **Found in:** task 14 task-11c (washer tab icons, ruling T11-W1)
- **Surface:** mobile (driver, valet, washer)

`apps/mobile/app/(driver)/_layout.tsx`, `(valet)/_layout.tsx` and now `(washer)/_layout.tsx`
each define the same local `tabIcon(outline, filled)` helper, the same `IconName` type, the
same `TAB_BAR_HEIGHT = 60` and the same `tabBarStyle` / `tabBarLabelStyle` block (safe-area
inset added to the height). `(owner)/_layout.tsx` has its own variant without the sizing.
Three copies that must change together (a tab-bar height or R-FE-12 icon-state change has to
land in all of them) is the R-ARCH-07 extraction trigger.

- **Why deferred:** the W2 fix was scoped to the washer layout; extracting touches the driver,
  valet and owner layouts, which is other roles' surface and needs its own design audit.
- **Done means:** one `tabIcon` and one tab-bar `screenOptions` factory in `features/shared/`
  (never `utils/`), used by all four role layouts; `tab-icons.test.ts` updated to follow it;
  each role's bar checked at 375x812 and at desktop width.

### S-54 — An admin-only account lands on choose-role, where every choice fails

- **Status:** `open`
- **Found in:** task 14 whole-branch spec review (task 11c, role routing)
- **Surface:** mobile

An account whose only role is `admin` signs in to the mobile app and lands on the choose-role
screen. Every role offered there is one the account does not hold, so each tap calls
`POST /me/roles/active`, gets a 403, and the screen says "please try again". Nothing the user
does from there can work. The admin surface is the web admin panel, not the app.

- **Why deferred:** the task 14 fix wave covers the partner surfaces; an admin-only landing is a
  new screen in the shared auth flow with its own design gate.
- **Done means:** an admin-only session lands on a screen that says to use the admin panel and
  offers sign-out, never on choose-role. A test signs in with `roles: ['admin']` and asserts
  that screen, and that choose-role is not reachable.

### S-55 — `owner_payable` by partner has no covering index

- **Status:** `open`
- **Found in:** task 14 final review, database lens M2
- **Surface:** database

The washer earnings summary (`washer-earnings.query.ts`) and the valet and owner balances all
ask for `owner_payable` rows by `counterparty_user_id`, bounded by `occurred_at`, and sum
`amount_paise` by `direction`. No index has that shape. The candidate is
`ledger_entries (counterparty_user_id, account, occurred_at) INCLUDE (direction, amount_paise)`,
which would make the summary an index-only scan.

- **Why deferred:** the need is unmeasured. The ledger is small, and an index on the
  append-only, highest-write table has a write cost that should be paid for a measured read.
- **Done means:** an `EXPLAIN (ANALYZE, BUFFERS)` of the summary query against a
  production-sized ledger shows the sequential scan or heap cost. Then a
  `CREATE INDEX CONCURRENTLY` migration, alone in its file and reviewed SAFE, adds the index,
  and the plan is re-run to show it used.

### S-56 — `washer_profiles.capabilities` is unchecked, and is a second source of truth

- **Status:** `open`
- **Found in:** task 14 final review, database lens L4
- **Surface:** database, api

`washer_profiles.capabilities` is a `text[]`. The contract limits it to the closed catalogue at
registration (ruling T10-S1), but the database accepts any string. It is also a second answer to
the question `wash_services.is_active` already answers ("which services does this partner
offer"). Registration writes both, and a menu toggle updates only `is_active`, so the two
disagree after the first edit.

- **Why deferred:** choosing which one is the truth is a design decision, and it touches the
  menu, the profile view and dispatch. A CHECK alone would harden a column that may be dropped.
- **Done means:** either `capabilities` is dropped (expand-contract) and the profile view derives
  it from active menu rows, or a CHECK (`capabilities <@ ARRAY[...catalogue]`, NOT VALID then
  VALIDATE, reviewed SAFE) is added and the menu toggle keeps it in step. A test toggles a
  service and reads both.

### S-57 — No database check on a business's photo count or a blank `business_name`

- **Status:** `open`
- **Found in:** task 14 final review, database lens L5
- **Surface:** database

The contract requires a business to register with 1–10 photos, and every partner to have a
non-blank `business_name` (rulings T10-C1, T10-C2). `washer_profiles` enforces neither, so a
console fix or a future write path can leave a business with no photos under review, or a
partner whose washer card has only whitespace for a name.

- **Why deferred:** rows written before T10-C2 have a NULL `business_name`. The CHECK needs a
  backfill decision first, and a migration reviewed on its own.
- **Done means:** existing rows are audited. Then a migration adds
  `CHECK (partner_type <> 'business' OR cardinality(business_photo_ids) BETWEEN 1 AND 10)` and
  `CHECK (business_name IS NULL OR btrim(business_name) <> '')`, both NOT VALID then VALIDATE
  and reviewed SAFE, and a test shows each direct write refused.

### S-58 — The earnings lines have no index and no stable order

- **Status:** `open`
- **Found in:** task 14 final review, database lens L6
- **Surface:** database, api

The earnings lines query filters `wash_jobs` by `washer_user_id` and `status = 'completed'` and
orders by `completed_at DESC`. `wash_jobs_washer_user_id_idx` serves only the equality, so the
sort covers every job the partner has done. Two jobs completed in the same instant also have no
tiebreak, so their order can change between two reads of the same page.

- **Why deferred:** a partner has few jobs today, so the cost is unmeasured. The index is a
  `CONCURRENTLY` migration of its own.
- **Done means:** a partial index
  `wash_jobs (washer_user_id, completed_at DESC, id) WHERE status = 'completed'` is added (alone
  in its file, reviewed SAFE), the query orders by `completed_at DESC, id DESC`, and a test with
  two equal `completed_at` values asserts a stable order.

### S-59 — ID images are `private`, but transformed renditions can still be public

- **Status:** `open`
- **Found in:** task 14 final review, security lens M3
- **Surface:** api, infrastructure (Cloudinary account)

`CloudinaryService` uploads `documents` with `type: 'private'`. Cloudinary's `private` delivery
protects the original, but a derived rendition (a resize, a crop) is publicly deliverable
unless Strict Transformations is enabled on the account. An ID image is exactly what must never
be reachable by a guessable transformation URL. The `authenticated` delivery type closes this
for every rendition.

- **Why deferred:** the choice between `authenticated` and `private` plus Strict
  Transformations is an account-level setting and a delivery decision for task 18's admin
  review screen, which has to render the image.
- **Done means:** either `documents` uploads use `type: 'authenticated'` and task 18 renders them
  through signed delivery URLs, or Strict Transformations is recorded as enabled on the account
  (with the date and who checked). A test pins the upload type for `documents`.

### S-60 — The name a driver sees is chosen by the partner, unreviewed

- **Status:** `open`
- **Found in:** task 14 final review, security lens L3
- **Surface:** api, admin

The washer card shows the driver `business_name`, which the partner types at registration
(ruling T10-C2). Nothing reviews it, so a partner can show drivers an impersonating or abusive
name ("ParkEase Support", a competitor's brand) from the moment they are verified.

- **Why deferred:** review is task 18's admin surface. Until it exists, verification itself is
  manual, so no partner reaches a driver without an admin having looked at the account.
- **Done means:** task 18's verification view shows the display name as part of what is
  approved. A name change after verification returns the partner to `pending` (or holds the new
  name until approved), and an HTTP test covers the change.

### S-61 — `washJobViewSchema.availableEvents` is `z.array(z.string())`

- **Status:** `open`
- **Found in:** task 14 final review, TypeScript lens L7
- **Surface:** contracts, mobile

`availableEvents` in `packages/contracts/src/washer/job-view.ts` lists the events the partner may
fire next, but it is typed as plain strings rather than `carwashJobEventSchema`. A typo or a
renamed event passes the parse and reaches the app, where a `switch` on it falls through to its
default without a compile error. This is the same shape as S-10's `verificationStatus`.

- **Why deferred:** narrowing it changes the type every consumer reads, and the mobile half
  belongs to part B of the fix wave.
- **Done means:** the field is `z.array(carwashJobEventSchema)`, the mobile consumers typecheck
  against the enum, and a contract test refuses an unknown event.

### S-62 — `grossPaise` means two things in one earnings response

- **Status:** `open`
- **Found in:** task 14 whole-branch spec review (task 3 / task 9, earnings)
- **Surface:** contracts, api, mobile, docs

In `GET /washer/earnings`, `summary.grossPaise` is what the ledger credited the partner, net of
commission. `lines[].grossPaise` is the driver-facing service price. The same name in one
response means the partner's money in one place and the driver's price in another. The task
file's Demo also expects `{grossPaise: 39900, commissionPaise: 7980, netPaise: 31920}` for the
summary, which the contract deliberately does not produce.

- **Why deferred:** a rename is a contract change for both consumers, and the mobile consumer is
  part B's surface.
- **Done means:** one of the two fields is renamed (for example `summary.creditedPaise` or
  `lines[].pricePaise`) in the contract, the API and the app. The task file's Demo is corrected
  to the shape the endpoint returns, and a contract test pins the new name.

### S-63 — R-FE-11's ≤1MB upload ceiling is asserted nowhere

- **Status:** `open`
- **Found in:** task 14 whole-branch spec review (preflight ruling R1 removed an unenforced
  constant)
- **Surface:** mobile

R-FE-11 says an upload is ≤1MB after compression. Preflight ruling R1 removed the constant that
claimed to enforce it, because nothing did: `expo-image-manipulator` returns no byte size. So the
rule is now stated and checked nowhere, and a camera that produces a large file after
compression would upload it.

- **Why deferred:** a real size probe needs a file-system read of the compressed output, which
  is a mobile change with its own device testing.
- **Done means:** either the compressed file's size is read (for example with `expo-file-system`)
  and an over-limit file is recompressed or refused, with a test, or the ceiling is recorded as a
  device-test check in `docs/testcases.md` with the device and the measured size.

### S-64 — Nothing bounds how long an API handler may run

- **Status:** `open`
- **Found in:** task 14 final fix wave (C1, choosing `IDEMPOTENCY_IN_FLIGHT_STALE_MS`)
- **Surface:** api

`IdempotencyService` treats an unfinished claim older than five minutes as stale and lets a
retry take it over. That is only safe if no live attempt runs longer. Nothing in the API
guarantees it: Fastify has no `requestTimeout`, the API's database connection has no
`statement_timeout`, and the Razorpay client call has no timeout of its own. So the five minutes
is a judgement rather than a derived bound. A handler that stalls longer than that (a hung
gateway call) can run twice.

- **Why deferred:** request, statement and gateway timeouts are cross-cutting settings for every
  endpoint, and each needs its own value argued. The fix wave only needed the stuck-key recovery.
- **Done means:** a Fastify `requestTimeout`, a pool `statement_timeout` and a gateway client
  timeout are set, each below `IDEMPOTENCY_IN_FLIGHT_STALE_MS`. A comment on the constant names
  them as the bound it is derived from, and a unit test asserts the ordering.

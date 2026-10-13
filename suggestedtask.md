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
- **Extended by the task 14 UI audit (M, job identity):** a partner walking up to a car needs
  to know it is the right one. The active job's header now names the tab ("Active") with
  "service · vehicle" as its subtitle; it should also carry the space's name, the car's plate
  and when the car leaves. None of those is on `WashJobView`. Done also means the job view
  gains `spaceName`, `vehiclePlate` and `bookingEndsAt` (plate masked per the privacy
  rules), and the active header's subtitle shows them.

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

### S-55 — `owner_payable` by partner has no covering index

- **Status:** `open` — measured 2026-10-13, not needed yet: at 1M ledger rows the washer summary is 1.8 ms on `ledger_entries_counterparty_user_id_idx` (500 heap blocks). Re-measure at 10M.
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

### S-66 — `washerKeys` are bare arrays, so a cache write is not type-checked

- **Status:** `open`
- **Found in:** task 14 final fix wave, H1/H3 (React lens)
- **Surface:** mobile

`features/washer/hooks/useWasherQueries.ts` keys the cache with `as const` arrays. So
`client.setQueryData(washerKeys.active, job)` accepts any value for `job`: nothing ties the key to
the `WashJobView | null` its query returns. H1 and H3 added more cache writes (the won job, the
held ID upload) and each is correct only by reading.

- **Why deferred:** moving the keys to `queryOptions()` changes every `useQuery` and
  `setQueryData` call in the file and the tests that mock them. The fix wave kept to the behaviour
  it was asked for.
- **Done means:** each key is a `queryOptions({ queryKey, queryFn })`, every `setQueryData`,
  `getQueryData` and `invalidateQueries` uses it, and a type test shows a wrong value for a key
  failing `tsc`.

### S-69 — Dev-mock preview leftovers (task 11b)

- **Status:** `open`
- **Found in:** task 11b live walk-through; task 14 final fix wave, L
- **Surface:** mobile (dev only)

Three dev-only items from the preview, none reachable in a release build:

- After a completion, the fixture earnings summary reads inconsistent with its lines:
  `recordCompleted` adds the line and bumps `jobsCompleted`, but leaves the summary's money
  figures as seeded.
- The fixture data (`features/washer/api/dev-fixtures.ts`) ships in the release bundle.
  `isWasherDevMock()` makes it unreachable, but Metro bundles every `require()`
  (learnings.md), so the bytes are there.
- Refusals as plain `Error`s: **closed by I7.** The store now throws the API's envelope with
  the server's status and code, so the preview takes the production failure paths.

- **Why deferred:** dev-only, and the first two need a fixture-summary recomputation and a
  build-time exclusion respectively, neither of which the partner sees.
- **Done means:** the fixture summary is recomputed from its lines by a helper that is itself
  dev-only, and the fixtures are excluded from release builds (a `__DEV__`-guarded `require`
  that Metro strips, or a separate entry), with a bundle check that the fixture file is absent.

### S-70 — The profile screen has no back arrow

- **Status:** `open`
- **Found in:** task 14 live walk-through (V-series), pending the device pass
- **Surface:** mobile

The washer profile is reached from the header account icon and is a hidden tab
(`href: null`), so it draws no back arrow. On Android the system back works; in the browser
preview there is no way back except the tab bar. H2's `popToTopOnBlur` keeps the stack sane; it
does not add the arrow.

- **Why deferred:** whether a hidden tab should draw a back arrow is a navigation-design call
  that the device pass decides (Android back may be enough), and section M owns the header.
- **Done means:** after the device pass, either the profile draws a back arrow that returns to
  the tab it came from, or the decision not to is recorded with the device evidence.

### S-71 — The Offers tab has no badge for waiting offers (§14.3)

- **Status:** `open`
- **Found in:** task 14 whole-branch spec review
- **Surface:** mobile

§14.3's tab bar shows a count on Offers when jobs are waiting. The washer layout draws four
plain tabs. A partner on Menu or Earnings has no cue that an offer is expiring.

- **Why deferred:** a badge needs the offers count outside the offers screen (a shared query
  subscription in the layout) and a design pass for its colour and size (section M territory).
- **Done means:** the Offers tab shows the number of open offers while online, from the same
  query the screen uses (no second poll), announced for TalkBack, with a test.

### S-72 — The active job shows no step timestamps (§14.4)

- **Status:** `open`
- **Found in:** task 14 whole-branch spec review
- **Surface:** mobile + contracts

The §14.4 wireframe shows a time beside each completed step (accepted 10:02, on the way 10:04).
`StepRail` shows the steps with no times, because `washJobViewSchema` carries only
`acceptedAt`, `startedAt` and `completedAt`, not the `en_route` time.

- **Why deferred:** the missing timestamp is a contract and database field, outside mobile.
- **Done means:** the job view carries a time for each step, `StepRail` shows it beside the
  step, formatted in IST with `hourCycle: 'h23'` (learnings.md), with a test.

### S-73 — A stale screen re-rendering is proven only at the cache level

- **Status:** `open`
- **Found in:** task 14 final fix wave, test-adequacy lens (H3)
- **Surface:** mobile

`washer-queries.test.ts` proves each mutation cancels in-flight fetches, writes the cache and
invalidates while another write runs. No test renders a screen through that cache and shows the
screen itself moving from the stale answer to the new one. A screen that read a stale local copy
would pass.

- **Why deferred:** a screen-level test needs a `QueryClient`, the screen's providers and the
  router mocked, a harness the washer screens do not have yet.
- **Done means:** one screen (the active job) is rendered with a real `QueryClient`, a mutation
  answer is written, and the rendered status changes with no refetch; a second case shows a
  late refetch cannot overwrite it.

### S-74 — ID-image copies linger in the app cache after upload

- **Status:** `open`
- **Found in:** task 14 security lens; task 14 final fix wave, L
- **Surface:** mobile

The camera writes the ID photo to the app's cache directory, and `expo-image-manipulator`
writes a compressed copy beside it. Neither is deleted after the upload lands, so an image of a
government ID stays on the device until the OS evicts the cache. The held upload id (G9) is in
memory only and is cleared on sign-out; the files are not.

- **Why deferred:** pairs with S-26 (erasure of partner personal data) and needs
  `expo-file-system` deletes with device testing of the cache paths.
- **Done means:** after an ID upload succeeds (and on sign-out) the original and compressed files
  are deleted, a test asserts the delete is called with both uris, and S-26 references this row.

### S-77 — The app has no support surface, so "Contact support" can go nowhere

- **Status:** `open`
- **Found in:** task 14 UI audit, impeccable P4 (fix wave B2, M10)
- **Surface:** mobile (washer and valet), product

The washer verification banner offered "Contact support" to a rejected (or unrecognised)
partner, and its button opened the profile, which has no support row. M10 removed that button:
the banner keeps its words and draws no action, because a button that leads nowhere is worse
than none. Valet has the same dead action: `features/valet/profile-status.ts` offers "Contact
support" and `app/(valet)/offers.tsx` routes every banner action to the valet profile.

- **Why deferred:** a support channel (in-app form, phone line, email, WhatsApp) is a product
  decision with an operational owner, not a screen fix, and valet was outside B2's scope.
- **Done means:** a support entry exists (a Profile row at least) with a real destination;
  `bannerActionRoute` in `features/washer/verification-copy.ts` routes "Contact support" to it
  and the rejected/unknown banners get their action back; valet routes its banner actions by
  what they say the same way.

### S-78 — The earnings hero is a period total, not settled money with a payout date

- **Status:** `open`
- **Found in:** task 14 UI audit (fix wave B2, section M rows)
- **Surface:** contracts, api, mobile

The washer earnings screen's headline is `summary.netPaise` for the chosen period. A partner's
real question is "what is coming to me, and when": money that has settled into their payable
balance, and the date of the next payout. Neither is on `WasherEarningsView`, and the period
total mixes settled and not-yet-settled jobs.

Task 16b changed the premise: a washer is paid by Route as each wash is paid (ADR-030), so
there is no payout date to show, and Get paid says so. What remains is "paid to your bank"
versus "not yet paid" (a wash whose driver has not paid, or a transfer not yet settled).

- **Why deferred:** needs contract fields and a ledger query (payable balance, next payout
  date from the payout schedule), which is server work and task 16's payout surface.
- **Done means:** the earnings view carries a settled balance and the next payout date from the
  server, the hero shows them (no client arithmetic, R-FE-06), and the period total becomes the
  secondary figure.

### S-81 — Empty and error states inside an outer ScrollView are top-aligned, not centred

- **Status:** `open`
- **Found in:** task 14 final fix wave (M1 inner-scroll fix), design audit
- **Surface:** mobile

M1 fixed `EmptyState` and `ErrorState` to scroll when short and centre when there is room. But
the washer profile, owner index, valet earnings and valet profile all render these states
inside their own `ScrollView`, and a zero flex basis collapses the state to nothing, so the
fix only takes effect at a size where the outer scroll is already scrolling. The state sits
top-aligned with no vertical breathing room. The screens pass no centring prop.

- **Why deferred:** the screens are outside task 14's file list. The fix is either a `flex` prop
  the screens can pass to override the grow-only layout, or dropping the outer `ScrollView` for
  the empty/error state and using `flex: 1` with the centring.
- **Done means:** one of those screens shows its empty state both top-aligned (when it overflows)
  and centred (when there is room), asserted in a test at 375px and at 812px tall.

### S-83 — The owner statement re-aggregates the owner's whole ledger history on every page

- **Status:** `open`
- **Found in:** task 15, database review of `OwnerBalanceQuery.statementQuery`
- **Surface:** api · db

`statementPage` groups `ledger_entries` per booking and applies the period bound and the keyset
cursor in `HAVING min(occurred_at)`, so every page — including the dashboard's three-line teaser —
joins and aggregates every `owner_payable` row the owner has before trimming. Keyset pagination is
therefore not sublinear: page 40 costs what page 1 costs. `listForOwner` has the related shape
issue (no `(space_id, status, starts_at)` index; the owner scope arrives through the `spaces` join).

- **Why deferred:** measured, not guessed. `owner-dashboard-performance.spec.ts` (10k bookings for
  one owner, 50k platform noise) puts `/owner/earnings/transactions` at p50 ~48 ms / p95 ~63–80 ms
  on page 1 and page 20, and `/owner/bookings?group=past` at p95 ~56 ms. The fix is a two-step
  query (select the page of booking ids first by `bookings.created_at` — which equals the first
  credit's `occurred_at`, both are the creating transaction's `now()` — then aggregate the ledger
  for those ids only), and possibly an index needing a reviewed migration. Neither earns its place
  at today's volumes.
- **Done means:** the statement page aggregates only the page's bookings (EXPLAIN shows no
  aggregation over the owner's full history), and the performance spec's transaction p95 stays flat
  when the seeded owner grows from 10k to 100k bookings.

### S-84 — Task 15 hand-off: owner reviews list

- **Status:** `open` (the payout-date half closed in task 16b — see below)
- **Found in:** task 15 spec §2 and §6
- **Surface:** api · mobile

`GET /owner/reviews` and a reviews tab were cut from task 15: nothing writes reviews until task 17,
so the endpoint would have been permanently empty.

Task 16b closed the other half differently from how it was written: owners are paid by Route as
each booking is paid (ADR-030), so there is no "next payout date" to show. "Owed to you" now
carries `owedCaption()` — paid as the driver pays, not yet paid, or a refund after payment.

- **Why deferred:** belongs to the task that creates its data (17: reviews).
- **Done means:** task 17 ships `GET /owner/reviews` (and respond) with a reviews section on the
  listing detail.

### S-88 — Owner mobile leftovers: dead `deleteSpace`, no QR icon on the scan button, stacked refresh notices

- **Status:** `open`
- **Found in:** task 15 fix wave 1, design audit, task 7 re-review
- **Surface:** mobile

(1) `apps/mobile/src/features/owner/api/spaces.ts` exports `deleteSpace` with no caller — no hook,
no screen. (2) The dashboard's "Scan a driver's QR" is a text-only secondary `Button`; the ui-native
`Button` has no icon prop. (3) On the owner earnings screen, if the summary and the transactions
both fail to refetch while cached data is shown, two identical "Couldn't refresh" bands stack.

- **Why deferred:** (1) pre-existing and unused; (2) an icon prop changes the shared kit every role
  uses; (3) a rare double failure whose current behaviour is loud, not silent.
- **Done means:** (1) delete it, or wire a delete-listing flow that also invalidates the dashboard;
  (2) `Button` takes an optional leading icon and the scan button uses `qrcode-scan`; (3) one
  combined notice when both refetches fail.

### S-89 — Listing detail shows at most 20 bookings per group

- **Status:** `open`
- **Found in:** task 15 test-adequacy review
- **Surface:** mobile

The Active and Upcoming groups on `(owner)/listings/[id]` fetch one page (limit 20) and render mapped
rows inside the screen's `ScrollView` — FlashList cannot virtualize nested in a vertical ScrollView.
Since fix wave 2 the cap is stated on screen when `meta.hasMore` is true, so nothing is hidden
silently, but the owner cannot page past it.

- **Why deferred:** 20 concurrent active or upcoming bookings on one space is beyond any space in the
  seed data; a real "all bookings" screen (FlashList, cursor paging over the existing endpoint) is its
  own screen.
- **Done means:** a "See all bookings" route lists a space's bookings in a FlashList with infinite
  paging over `GET /owner/spaces/:id/bookings`, and the listing detail links to it when `hasMore`.

### S-90 — Owner test-coverage leftovers

- **Status:** `open`
- **Found in:** task 15 per-task and test-adequacy reviews
- **Surface:** api · mobile

Small, real gaps: no
occupancy test for a space with zero `space_slots` rows; `statementCount` fetches grouped rows to
count them (see S-83); no tests for `useOwnerQueries` cache keys or `getNextPageParam`; `SpaceRow`'s
accessibility label is untested; `devTransactions` parses its cursor with an unchecked `parseInt`;
the ₹97.02 case is asserted twice (query and HTTP spec).

- **Why deferred:** each covers code already correct by inspection; none guards money or
  authorisation.
- **Done means:** each named case has a test, `statementCount` is a `count(*)` over the grouped
  subquery, and the duplicate HTTP assertion is narrowed to wiring.

### S-91 — Owner endpoint rate limits are a judgment call

- **Status:** `open`
- **Found in:** task 15 task-4 review
- **Surface:** api

The five owner GETs got explicit 60/min/user policies in `platform/ratelimit/policies.ts`. The number
was chosen by the implementer, not specified anywhere.

- **Why deferred:** needs a product decision, not code.
- **Done means:** product confirms or changes the limit, and the policy table cites the decision.

### S-94 — Two pre-existing owner-listing a11y misses: rejection reason contrast, 36dp action button

- **Status:** `open`
- **Found in:** task 15 fix wave 5 (while extracting the shared approval-status map)
- **Surface:** mobile

(1) `(owner)/listings/[id].tsx` renders the rejection reason with `colors.error` text on
`colors.errorLight` — 4.41:1, under AA (the token file documents the pair as failing). (2)
`features/owner/components/ListingCard.tsx`'s Activate/Deactivate `actionButton` has `minHeight: 36`,
under the 48dp `touchTarget` token.

- **Why deferred:** both pre-date task 15 (task 6) and sit outside the screens this task changed.
- **Done means:** the rejection reason uses `errorInk` (or a surface background) with a contrast test,
  and the action button uses `touchTarget`, covered by the owner touch-target audit.

### S-95 — The mobile app never loads Plus Jakarta Sans; every screen renders the system font

- **Status:** `open`
- **Found in:** launch series (brag) Task 2, building the video type system — 2026-09-28
- **Surface:** mobile · tokens

The Wayfinder direction (CLAUDE.md, chosen 2026-09-14) names Plus Jakarta Sans as the type, but no file
in the repo references it: no `useFonts`, no `@expo-google-fonts/plus-jakarta-sans`, no font asset, no
`fontFamily` token. Web captures of every role render the platform sans. The launch videos set their
captions in Plus Jakarta Sans (OFL, `brag-output/_series/fonts/`), so the phone screens and the captions
around them currently use different faces.

- **Why deferred:** a design-system change across every screen, far outside a video task; it needs its
  own design gate (weights, fallback, bundle size, Android font scaling).
- **Done means:** `packages/tokens` exports `fontFamily` for the Wayfinder weights, the app loads them
  before first render (splash held), every `Text` inherits them, and a test fails if a screen renders
  without the family.

### S-96 — Owner dev fixtures disagree with themselves: "This month" is ₹12,800 on the dashboard, ₹8,925 on Earnings

- **Status:** `open`
- **Found in:** launch series (brag) video 06 capture — 2026-09-29
- **Surface:** mobile (dev-mock only)

`apps/mobile/src/features/owner/api/dev-fixtures.ts`: `devDashboard` reports this month as ₹12,800 while
`devEarnings` for the same month totals ₹8,925 over 58 bookings, and some `devTransactions` rows name a
space ("Stilt Parking, Palm Meadows") the dev owner never created. Today (₹480, 3 bookings) agrees. The
real API cannot disagree (both are one ledger query), but the fixtures are how screens are reviewed and
filmed, and a reviewer comparing the two screens sees a bug that isn't there.

- **Why deferred:** dev-only fixture data; the launch video avoids the Month view instead.
- **Done means:** the owner fixtures derive the dashboard figures from the same transaction list the
  earnings fixture serves, with a unit test asserting dashboard month = sum of earnings month.

### S-106 — The owner's scan screen keeps re-posting check-in after a successful scan

- **Status:** `open`
- **Found in:** launch series (brag) owner video capture — 2026-09-29
- **Surface:** mobile

`app/(owner)/scan.tsx` disables `onBarcodeScanned` only while the mutation is pending. Once the success card
is showing, the camera is still live on the same QR, so every `RESCAN_COOLDOWN_MS` the same token posts
`/owner/bookings/:id/check-in` again: four POSTs in ~9s during capture. The server is idempotent, so no data
is harmed, but it is wasted traffic, rate-limit budget, and a re-render under the owner's thumb.

- **Why deferred:** found while filming; a behaviour change needs its own test.
- **Done means:** scanning pauses while a result card is shown (until "Done" or a new-scan action), with a
  component test asserting one POST per QR presentation.

### S-99 — Owners and washers have no rail for money Route cannot carry

- **Status:** `open`
- **Found in:** task 16a (ADR-030: one rail per payee)
- **Surface:** worker · money

RazorpayX pays only users without an activated Route Linked Account, so a positive residual owed
to an owner or washer is never paid. Examples are a promotional credit, an admin adjustment or a
dispute outcome. Nothing creates such a residual today.

- **Why deferred:** the flows that create them are task 18's (admin adjustments) and task 17's
  (disputes). Opening the rail now would reintroduce the double-payment risk for no present gain.
- **Done means:** the payout query pays a Route-onboarded payee only rows the posting marks as
  "not Route-settled" (for example an adjustment `txn` kind), with a test that a capture next to an
  adjustment pays only the adjustment.

### S-103 — Payout and reconciliation queries scan more than they will need to

- **Status:** `open` — measured 2026-10-13, not needed yet: at 1M ledger rows the weekly candidate query is 304 ms (a weekly cron); at 300k payments the reconcile candidates are 64 ms (nightly). The reconcile switch to `transfers.all` stays the next step when capture volume grows.
- **Found in:** task 16a database review, plus the per-payment `ponytail:` ceiling
- **Surface:** db · worker

Three places scan more than they will need to at volume:

- The weekly candidate query aggregates every `owner_payable` row.
- `notSettlement()` probes `ledger_entries_txn_id_idx` and a heap fetch per earnings row.
- Reconcile makes one Razorpay call per uncleared capture, with no index on `payments.captured_at`.

All are fine at launch volume.

- **Why deferred:** each fix is a CONCURRENTLY index in its own migration, or an API switch, and
  none is needed at launch volume.
- **Done means:** when measured slow, add partial indexes on:

  - `ledger_entries (counterparty_user_id) WHERE account = 'owner_payable'`
  - `ledger_entries (txn_id) WHERE account = 'settlement_clearing'`
  - `payments (captured_at) WHERE route_transfer_paise IS NOT NULL`

  Also switch reconcile to `transfers.all({ from, to })`. Each change is justified by an EXPLAIN
  before and after.

### S-108 — Uncaught "12000ms timeout exceeded" from an icon font on the web build

- **Status:** `open`
- **Found in:** launch series (brag) driver probe — 2026-09-29
- **Surface:** mobile (web build)

LogBox shows an uncaught error from FontFaceObserver (`entry.bundle`, the `D.prototype.load` font loader) about 12s
after the driver home loads: a font-load promise rejects with nobody handling it. On the web build this is a
red-screen in dev; it may also mean an icon font never finishes loading.

- **Note (2026-10-13):** not reproduced — driver home on the web build stayed open for minutes with no
  font timeout and no console error. Likely a slow first load of the icon font; nothing in the app loads
  fonts explicitly yet (see S-95).
- **Why deferred:** web-only, found while filming.
- **Done means:** the font load that times out is identified, its rejection is handled (R-FAIL-01: logged at
  warn with context), and the icon font loads or falls back deliberately.

### S-109 — On web, focusing a price input on listing step 4 shifts the whole step sideways

- **Status:** `open`
- **Found in:** launch series (brag) owner capture — 2026-09-29
- **Surface:** mobile (web build) · owner listing wizard, step 4 "Set your pricing"

With the two-wheeler "Hourly (required)" field focused, the input's focus box extends past the right edge and
the whole step renders ~20px to the left ("Set your pricing" shows as "ur pricing"). Blurring restores the
layout. Resetting `scrollLeft` on every element does not, so it is layout overflow, not a scrolled container.

- **Why deferred:** web-only, found while filming; the video uses a blurred still.
- **Done means:** the focused input stays inside its row (width constrained, focus ring inset), checked at 390px
  width on web, and on Android with the keyboard open.

### S-110 — A MapLibre runtime error on web leaves a blank map instead of the fallback

- **Status:** `open`
- **Found in:** fix/web-map review (silent-failure lens) — 2026-09-29
- **Surface:** mobile (web build) · packages/ui-native `ParkMap.tsx`

`WebMap` registers no `map.on('error')`. If the worker files are missing at runtime (install scripts skipped,
a deploy that never ran postinstall) or the style fails, the map is blank with no reason shown. Not done in
fix/web-map because MapLibre also emits `error` for every transient tile failure: flipping the whole map to
"Map unavailable" on a tile hiccup would be a new bug. It needs a design for which errors are fatal.

- **Why deferred:** needs its own design (fatal vs transient errors); fix/web-map already makes install fail
  loudly when the worker cannot be copied.
- **Done means:** worker/style failures switch ParkMap to its fallback with the reason (R-FAIL-01); transient
  tile errors do not; a test covers both.

### S-111 — Driver map: price pins overlap at the default zoom, and clustering does not merge them

- **Status:** `open`
- **Found in:** fix/web-map UI audit (mobile-app-design lens) — 2026-09-29, first time the web map rendered
- **Surface:** mobile · `features/driver/clustering.ts`, `ParkMap` markers

At the driver home's default zoom over Koramangala, about eight of the 21 sample pins overlap in the centre:
their prices are unreadable and their 48px hit areas overlap, so which space a tap selects is ambiguous
(Material asks for 8dp between targets). Clustering only merges above `CLUSTER_MAX_ZOOM`'s threshold, so
nearby-but-distinct pins stay separate and stacked. Contrast and target sizes themselves pass.

- **Why deferred:** pre-existing and shared with native; a clustering/zoom design question, outside the fix.
- **Done means:** pins that would overlap at the current zoom merge into a count cluster (or the initial zoom
  frames them apart), checked with the dev fixtures at 390px, with a clustering unit test for overlap.

### S-114 — The one-rail rule reads the payee's status today, not how each entry was paid

- **Status:** `open`
- **Found in:** task 16b database review, 2026-09-30
- **Surface:** db `partnerPayable`

`partnerPayable` drops every `owner_payable` row of a payee whose Linked Account is activated
_now_. A RazorpayX balance earned before activation would never be paid by either rail. The
reviewer's second scenario (a suspended payee paid twice) is refuted: `routeDischargeEntries`
debits `owner_payable` with the same counterparty at capture, so Route-paid rows net to zero.

- **Why deferred:** unreachable today — 16b gates wash offers on activation, owners' rows are
  owner-side and never in this predicate, and valets are never on Route. Nothing is live.
- **Done means:** the predicate keys on the entry (a Route discharge marks what Route paid), not
  on the payee's current status, with a test of a pre-activation balance being paid.

### S-117 — Route onboarding only knows individuals

- **Status:** `open`
- **Found in:** task 16b design, 2026-09-29
- **Surface:** api `RouteHttpClient` · mobile Get paid

Every Linked Account is created with `business_type: 'individual'`. An owner who is a
proprietorship, partnership or company cannot onboard correctly (their KYC is a GSTIN/business
PAN, not a personal PAN).

- **Why deferred:** P2P parking in the launch market is individuals; business owners need their
  own form and document set.
- **Done means:** a business-type choice on Get paid, the matching Razorpay fields, and tests.

### S-120 — Commission waivers can only be granted by activation, never by an operator

- **Status:** `open`
- **Found in:** task 16c design (ADR-032), 2026-10-05
- **Surface:** api · admin (task 18)

The 50 slots fill automatically at first Route activation. Nobody can grant a slot to an owner who
was onboarded by hand, revoke one granted in error, or see which slots are taken.

- **Why deferred:** there is no admin panel until task 18; an endpoint with no screen would be
  reachable only by script.
- **Done means:** task 18 lists grants (slot, owner, window), and grants or revokes one with an
  audit row; revoking ends the window at the moment of revocation, never back-dates bookings.

### S-121 — Commission-free applies to parking owners only

- **Status:** `open`
- **Found in:** task 16c design (ADR-032), 2026-10-05
- **Surface:** pricing · carwash · valet

Washers and valets have their own commission rates (20%) and are excluded from the launch offer.

- **Why deferred:** prd §15 Risk 1 names owners (supply of spaces); a partner promotion is a
  separate product decision.
- **Done means:** a product decision either way; if yes, the carwash and valet fee compositions
  take the same waiver field and posting.

### S-122 — Owners are not told before their commission-free window ends

- **Status:** `open`
- **Found in:** task 16c design (ADR-032), 2026-10-05
- **Surface:** worker · notifications

The dashboard row simply disappears when the window ends, and the next booking pays the normal
commission without warning.

- **Why deferred:** a scheduled reminder is a worker job and a notification template (task 19's
  surface); the window is visible on the dashboard meanwhile.
- **Done means:** a daily job notifies each owner 7 days before `ends_at`, once, idempotently.

### S-128 — The nightly review recompute scans `reviews` by `created_at` with no index

- **Status:** `open` — measured 2026-10-13, not needed yet: 75 ms over 300k reviews (a nightly job). Linear; re-measure past 3M reviews.
- **Found in:** task 17a database review, 2026-10-05
- **Surface:** db · worker

`ageingReviewTargets` filters a week of `created_at`; no index leads with it, so it is a sequential scan.
Fine at launch volume, linear in total reviews.

- **Why deferred:** no volume yet; an index is a write cost on every review.
- **Done means:** an EXPLAIN on a seeded volume shows the scan matters, then
  `CREATE INDEX CONCURRENTLY … (created_at) WHERE deleted_at IS NULL` in its own migration.

### S-131 — Owners' reviews of drivers are stored but never aggregated

- **Status:** `open`
- **Found in:** task 17a scoping (user-approved cut), 2026-10-05
- **Surface:** db · api

`recomputeRatingAggregate` is a no-op for `driver`: `users` has no rating columns and nothing reads a
driver rating, so a read model would be maintained for no reader.

- **Why deferred:** YAGNI until something gates on it (an owner auto-decline, a driver trust badge).
- **Done means:** that consumer exists; `users` gains the rating pair with the same CHECK as
  `spaces_rating_read_model_check`, and the recompute writes it.

### S-137 — The owner reviews section was not opened in a running app

- **Status:** `open`
- **Found in:** task 17b visual check, 2026-10-05
- **Surface:** mobile · `app/(owner)/listings/[id].tsx`, `features/owner/components/OwnerReviewsSection.tsx`

In a dev-mock session the owner listing detail only opens listings created in that session, and creating
one is blocked on web by the blank map (S-107, fixed on fix/web-map). The section is covered by a render
test (ordering, chips, respond) but was not looked at on a screen.

- **Why deferred:** blocked by S-107 on this branch.
- **Done means:** after fix/web-map merges, create a listing in the web preview, open its Reviews section at
  375 and 1280 wide, and check respond / report / show more.

### S-132 — The router's global-skill count is stale: 56 documented, 110 on disk

- **Status:** `open`
- **Found in:** installing Emil Kowalski's skills (ADR-033), 2026-10-05
- **Surface:** harness — `~/.claude/skills/flow/`, `CLAUDE.md`

`gen-skills-index.py` reports `global=110`. `flow/SKILL.md`, `reference/skill-index.md` and
`CLAUDE.md` all say 56. The difference is global installs made outside ParkEase (firecrawl ×28,
linkedin ×14, hyperframes ×9, brag, media-use and others) — never routed, and never run through
`audit-conflicts.sh`'s known list on purpose. The generator exists to make exactly this drift loud.

- **Why deferred:** those skills are global and mostly unrelated to ParkEase; routing them is its
  own curation pass, and ADR-033 was scoped to the ten project-local skills.
- **Done means:** each of the 54 is either routed in `reference/skill-index.md` or listed under
  "not routed for ParkEase", and the three documents state the count the generator prints.

### S-143 — Admin panel (18b) client contract notes from 18a

- **Status:** `open`
- **Found in:** task 18a, 2026-10-06
- **Surface:** admin (18b)

POST `/auth/admin/refresh` and `/logout` with `{}` (Fastify answers 400 to an empty JSON body); set `ADMIN_ORIGIN` and `TRUST_PROXY_HOPS` in prod env; verify Cloudinary `image/download` signed URLs against a real authenticated upload (no `format`, SHA-256) — untested live; a phone search must send the full number URL-encoded.

- **Done means:** 18b's session client and partner document viewer are built and checked against these.

### S-144 — Admin panel (18b/18c) follow-ups deferred to keep the task small

- **Status:** `fixed` except the user detail page (the list already shows every field it would).
- **Found in:** task 18b/18c build, 2026-10-07
- **Surface:** admin · api

Not built: the surge heat map (needs an API that lists every zone's live multiplier, not only overrides); a tier-ladder editor for zone overrides (overrides are created inheriting the global ladder; cap/tiers editable via the API); the bookings/revenue chart on the dashboard; Playwright E2E for approve / request changes / grant role / refund / surge edit / remove review / export; route-level code splitting (one 1.7 MB bundle: antd + firebase); `/admin/users/:id` detail page. Verified instead: unit tests for the API client (single-flight refresh, error envelope, contract refusal) and money formatting, and every page opened against dev fixtures at desktop and 375 px.

- **Done means:** each item built with a test, or ruled out here.

### S-145 — Task 19a events and templates the spec lists that have no producer yet

- **Status:** `open`
- **Found in:** task 19a, 2026-10-07
- **Surface:** api · worker · notifications

The spec's matrix has rows nothing emits: `booking.new` (the owner is never told of a booking: `booking.confirmed` carries no owner id, so the mapper needs a space lookup), `valet.arrived`, `role.added`, `payout.processed` (the payout job posts no notification on success), and `review.created` (its payload carries a polymorphic target, not an owner id). The catalog has no entry for them, so nothing can be dispatched by mistake. Also: copy omits the spec's `{space_name}`, `{time}`, `{valet_name}`, `{eta}` because producers send ids only; a lookup in the worker would restore them. `EXPO_ACCESS_TOKEN` is optional and absent from `.env.example`. A push-only dedupe table closes the in-app-off double-send gap documented in `dispatch.job.ts`.

- **Why deferred:** each needs a producer change or a read in the worker, and 19a is the delivery path and the feed.
- **Done means:** each row either emits and maps (with a test through the relay) or is struck from the matrix here with the reason.

### S-147 — Task 19b gaps: no real-device push check, no EAS project id, no in-app permission prompt flow

- **Status:** `open`
- **Found in:** task 19b, 2026-10-07
- **Surface:** mobile · notifications

Push registration and the tap-to-open path are unit-tested with mocked Expo modules and the feed and settings were walked in the web preview on fixtures. Nothing has run on a physical Android device: `getExpoPushTokenAsync` needs an EAS project id (`extra.eas.projectId`, written by `eas init`), which the repo does not have, so on a real build `registerForPush` currently logs "no EAS project id" and registers nothing. Permission is requested on first sign-in with no pre-prompt explaining why, and a user who denied it gets no route back (the settings screen does not link to the system settings). The Alerts tab for drivers and a Profile row for the other roles are the only entry points; owners, valets and washers have no bell on their main screens.

- **Why deferred:** needs an Expo account and a device; the rest is polish on a working path.
- **Done means:** `eas init` committed, one push received and tapped on a physical Android device for each of driver, owner and valet (cold start and foreground), a pre-prompt before the permission request, and a Settings link when permission is denied.

### S-151 — Task 21's Maestro journeys, cold-start and install-size checks do not exist

- **Status:** `blocked` — needs an Android device or emulator and an EAS build (S-148 and S-149 are now done, so the journeys can be written).
- **Found in:** task 21 gap review, 2026-10-07
- **Surface:** mobile · E2E · release

`apps/mobile/.maestro/` holds the two washer flows from task 14, still never executed. The valet flows S-04 names are not in the repo. There is no `driver-full-journey.yaml`, `owner-full-journey.yaml` or `valet-full-journey.yaml`. Nothing measures cold start (< 3s) or install size (< 20MB, ADR-023): there is no `android/` directory and no EAS profile to build from.

- **Done means:** the three journeys exist and run green on a Redmi 9A-class device against a seeded API, with output in the PR. Cold start is measured by Maestro. The release AAB size is recorded and checked in CI.

### S-154 — Two admin integration tests fail under CPU contention

- **Status:** `open`, narrowed — the refund-retry half is fixed (the idempotency interceptor now answers only after its store settles, so an immediate retry replays; 4/4 runs green). The export-cap case can still see its first two exports finish before the third arrives on a fast runner.
- **Found in:** task 21, first full-suite run beside other work, 2026-10-07
- **Surface:** api · test

`admin-bookings-http.spec.ts` "a failed re-read after the refund commits is not a 500, and a retry does not refund again": the retry got `409` (expected `200`). `admin-completion-http.spec.ts` "caps concurrent exports, answers 429…": the third export got `200` (expected `429`), because the first two finished before it arrived. Both passed 3 of 3 times in isolation. CI now runs the integration suite on every change (task 21), so a slow runner will show these.

- **Done means:** the refund retry waits for the stored response, the way `booking-http.spec.ts` does with `vi.waitFor`. The export test holds the first two streams open deterministically instead of racing them. Both pass 20 runs under full-suite load.

### S-156 — Ledger imbalance and outbox lag are log lines; nothing pages, and nothing watches a dead worker

- **Status:** `open` (feeds task 22), narrowed — `GET /health/pipeline` now reports outbox lag from the API with the worker's own query and answers 503 past the 30 s budget, so an uptime probe notices a dead worker. Left for task 22: routing `LEDGER_IMBALANCE`, `OUTBOX_LAG`, `QUEUE_SLO` and `DEAD_LETTER` to a pager.
- **Found in:** task 21, 2026-10-07
- **Surface:** worker · ops

Task 21 fixed `ledger.assert-balance` so a one-sided posting is found, and the outbox relay now logs `OUTBOX_LAG` past 30s. Both are `logger.fatal` / `logger.error` only. §21.3 #16 says the job "pages immediately", and the finance dashboard does show IMBALANCED (`imbalancedTxnIds`). If the worker itself is down, nothing reports lag at all, because the check runs inside the relay.

- **Done means:** task 22's alerting routes `LEDGER_IMBALANCE` and `OUTBOX_LAG` to a pager, and an external probe (or the API's health endpoint) reports outbox lag from the same query, so a dead worker is noticed.

### S-157 — No table-driven screen-states test (§21.8) and no automated accessibility checks

- **Status:** `open`, narrowed — done: a mobile screen-states table (`src/__tests__/screen-states.test.tsx`) over the data screens, a test failing any unlabelled Pressable, an admin Playwright table of every page's loading/error/empty states, and axe on every admin page. Left: the manual TalkBack pass of search → book → confirm (needs a device).
- **Found in:** task 21 gap review, 2026-10-07
- **Surface:** mobile · admin

Skeleton, error and empty states exist per screen and are unit-tested one component at a time. No test enumerates every screen and asserts all three. Nothing enforces `accessibilityLabel` and `accessibilityRole` on every `Pressable` (R-FE-12): no lint rule, no test. Admin has no axe-core check. TalkBack and VoiceOver passes of the booking flow have not been done.

- **Done means:** a `*.states.spec.tsx` table covers every mobile route, and an admin Playwright spec covers every page, each asserting skeleton, error and empty states. A lint rule or test fails a `Pressable` without a label. `@axe-core/playwright` runs on the admin flows. A manual TalkBack pass of search → book → confirm is recorded.

### S-159 — Task 20 web: optional cleanup from the simplify review

- **Status:** `open`
- **Found in:** task 20 (marketing site), `/simplify` review, 2026-10-12
- **Surface:** `apps/web`

Four tidiness items the review found and the task deliberately skipped. None changes what the site renders.

1. **Timeline wrapper.** `app/how-it-works/page.tsx` wraps each `Timeline` tab panel in the same `rounded-t-3xl bg-porcelain px-6 py-16 text-ink md:px-12` div. `app/partners/page.tsx` repeats that wrapper for its panels. Move it into `Timeline` (or one shared panel component) so each tab is `content: <Timeline stages={…} />`.
2. **`LeavingCar` re-draws `Car`.** `components/sections/ParkingFloor.tsx` repeats `Car`'s svg, viewBox, body and roof rects and drop shadow, and adds only the tail lights. The roof opacity has already drifted (0.05 against 0.045). `Car` should take `className` and `children`, so `LeavingCar` becomes `<Car color={carLeaving} className="floor-leaving …">{tailLights}</Car>`.
3. **Story screens ship as JavaScript.** `components/sections/HowItWorks.tsx` is a client component, but its three phone screens are fixed markup; only `data-active`/`aria-hidden` depend on state. Render the screens on the server and pass them in as `screens: readonly [ReactNode, ReactNode, ReactNode]`, the way `map` already is. Map them through one `<Screen index active>` wrapper instead of repeating it three times. This shrinks the home page client chunk (about 7.8KB) and its hydration work.
4. **Calculator `slider()` takes 9 positional arguments.** In `components/sections/EarningsCalculator.tsx`, `min`/`max`/`step` or the shown/spoken strings can be swapped without the compiler noticing. Use a `<RangeField label min max step value shown spoken onChange />` component with named props.

- **Why deferred:** pure maintainability; the project owner chose to ship tests, security review and docs first.
- **Done means:** all four applied; `pnpm turbo run lint typecheck test --filter=@parkease/web...`, `pnpm --filter @parkease/web test:e2e` and Lighthouse CI green; the home page chunk is smaller in `next build` output.

### S-160 — Task 20 web: review findings consciously not taken

- **Status:** `open`
- **Found in:** task 20, `/code-review` and `/simplify`, 2026-10-12
- **Surface:** `apps/web`

1. **Find-parking map inlined twice.** The dark hero map's SVG (about 14KB after the `<use>` change) is in the HTML and again in the RSC payload. A force-static `indiranagar-dark.svg` route loaded as `<img fetchpriority="high">`, with the pin keyframes inside the SVG, would halve it. The cost: labels lose the page web font, and the pin animation must live in the SVG.
2. **Share image on the edge runtime.** `app/opengraph-image.tsx` uses `runtime = 'edge'`, as task 20 §20.10 specifies, so it is not prerendered. It re-renders on each CDN miss and fetches the font a second way (`import.meta.url`, where the icons use `lib/og-font.ts`). Dropping edge would make it a build-time static file. That needs a spec decision.
3. **City ISR with compiled-in data.** `app/[city]/page.tsx` keeps `revalidate = 86_400` per §20.1. Today it regenerates identical pages; it only matters once cities come from the API.
4. **Legal contents list is hand-kept.** `lib/legal.ts` `sections` duplicate each MDX file's `##` headings, held together by `test/legal.spec.ts`. A small remark plugin exporting `headings` would remove both. The same applies to blog posts (`BLOG_POSTS` + `BLOG_CONTENT` + `.mdx` could become one `export const meta`).
5. **Calculator float math.** `lib/earnings.ts` uses the spec's `Math.round(gross × (1 − rate)) × 30` in floating point, not contracts' paise/`mulRate` rounding. It agrees on every spec example; a paise-based version would guarantee agreement with what the API pays.
6. **Theme names in three places.** `globals.css` `@theme` still maps `--color-*` to the generated `--pe-*` variables by hand. Emitting that block from `webColors` at build time would remove the last hand-kept copy.

- **Why deferred:** each trades a spec instruction, a visual detail or new build tooling for a small gain; none is a defect.
- **Done means:** each item either applied with tests green, or closed with a one-line reason in `learnings.md`.

| task-22 | `apps/*/Dockerfile` | Image runs under tsx with devDeps because packages export raw `.ts`. Slim image + `pnpm deploy --prod` needs packages to emit `dist`. Also unverified: healthcheck against live DB, worker-host ADR-010 amendment, CI docker push, everything in 22.8 that needs real accounts. |

### S-161 — Onboarding still uses the pre-Wayfinder indigo palette

- **Status:** `open`
- **Found in:** task 22, opening the mobile web build
- **Surface:** mobile · `app/(auth)/onboarding.tsx`

The three slides hard-code `#4F46E5` / `#EEF2FF` (indigo, replaced by Wayfinder on 2026-09-14),
`#D97706` and `#FFFBEB` as literals rather than tokens. It is the first screen a demo visitor sees.

- **Why deferred:** a visual change needs the design gate; task 22 only made the pager work on web.
- **Done means:** the slide colours come from `@parkease/tokens` (primary/available tiers), and
  `design-literals.test.ts` covers the file.

### S-162 — `screen-states.test.tsx` times out under parallel turbo load

- **Status:** `open`
- **Found in:** task 22, `pnpm turbo run lint typecheck test --concurrency=4`
- **Surface:** mobile tests

With four turbo tasks in parallel, the first case hit vitest's 5 s default timeout and 8 more
cascaded (empty text where copy was expected). Alone, and at `--concurrency=2`, all 15 pass.

- **Done means:** the file sets its own `testTimeout` (or awaits screens with `findBy*`), and a
  `--concurrency=4` run is green three times in a row.

## Product decisions recorded

- **S-149, 2026-10-12: self-serve roles, gated.** A person takes on owner, valet or washer from the
  app (`POST /me/roles`, audited as `user.role.self-grant`). The role is not the gate: a listing
  goes live only after admin approval, and a partner profile starts unverified, which every way to
  work checks. A suspended role stays closed; `admin` is never self-serve.
- **S-100, 2026-10-12:** changing bank details needs a fresh OTP (re-auth within 5 minutes), and
  payouts to the new account are held 48 hours.
- **S-123, 2026-10-12:** the commission-free slot is granted at a person's first approved space,
  with Route activated.
- **S-124, 2026-10-12:** drivers are not shown the owner's share; the breakdown says "Most of this
  goes to the space owner" without an amount.

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

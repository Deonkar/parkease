# Maestro flows: mobile E2E

These are the first Maestro flows in this repo. They cover the car wash partner app from task 14.

> **Not yet executed.** You need an Android emulator or device and the
> [Maestro CLI](https://maestro.mobile.dev) to run these flows. The environment
> they were written in had neither. The YAML parses, and every `id:` selector
> matches a `testID` in the source, but nobody has seen these flows pass. Don't
> read them as a green check until a run says so.

| Flow                               | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `washer-first-job.yaml`            | A verified washer goes online, accepts an offer, taps **On My Way**, takes the before photo, taps **Start Washing**, takes the after photo and taps **Mark Complete**. The flow then opens Earnings and checks that the job is listed with its **You earned** amount.                                                                                                                                                                                |
| `washer-verification-pending.yaml` | A washer whose documents are pending sees the **Verification in progress** banner. The online switch is disabled and says why in words ("You can go online once your documents are approved"). Tapping the switch changes nothing. Controller ruling T6-R1 replaced the task file's "offers visible, Accept locked" check: the server refuses to put an unverified washer online (`403 WASHER_NOT_VERIFIED`), so a pending washer never sees offers. |

## Preconditions

Both flows launch the app **without** `clearState`. Clearing app data would sign the
user out, and neither flow scripts the Firebase phone-auth login.

**`washer-first-job.yaml`**

- The app is installed (a dev or release build of `in.parkease.app`). It is signed in as a
  seeded washer whose active role is `washer`.
- That washer is `verification_status = 'verified'` and is onboarded for payouts. Without
  payout onboarding, accept answers `WASHER_NOT_ONBOARDED`.
- The washer has no live job.
- The washer's service menu has a row for the service and vehicle type in the request below.
- A live wash request is waiting within dispatch radius of the device's location. On an
  emulator, set the location with `adb emu geo fix <lng> <lat>`.
- The camera works. The emulator's virtual scene camera is enough.

**`washer-verification-pending.yaml`**

- The app is signed in as a washer with a registered profile and
  `verification_status = 'pending'`.

## Running

```bash
maestro test apps/mobile/.maestro/                              # both flows
maestro test apps/mobile/.maestro/washer-first-job.yaml         # one flow
```

## Notes

- **Permissions.** `launchApp` passes `permissions: { all: allow }`, which is Maestro's
  documented way to grant runtime permissions at launch. Location and camera dialogs
  therefore shouldn't appear. `optional: true` taps on the Android dialog buttons catch a
  device that shows one anyway.
- **The shutter is selected by `testID="wash-camera-shutter"`.** Its accessibility label
  ("Take the before photo") is shared with the empty evidence frame under the modal, so a
  label selector would be ambiguous.

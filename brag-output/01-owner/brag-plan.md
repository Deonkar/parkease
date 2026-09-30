# Brag Plan: ParkEase — 06 "The statement" (task 15)

Series: `docs/launch/brag-series.md` (Daylight look, spine, honesty + public-scope rules).
Source material: `captures/` — real app, owner dev-mock, 390×844 @3 (1170×2532).

## What is this app?
ParkEase is a peer-to-peer parking marketplace for India; task 15 gives the space owner a
dashboard and earnings screen where every rupee is traceable to a line: base, fee, what you earned.

## The angle
Consumer: **the statement you can trust** — calm, legible money. No hype; the owner sees
their parking spot's earnings the way a bank statement shows them.
Engineering: **one booking, three answers → one query.** v1 showed an owner three different
earnings for the same booking; now every figure on the screen is one ledger read, and a test
proves the screens agree.

## Hook (first 2–3 seconds, after the 1.8s sting)
Consumer: the phone rises onto the dashboard; the line "Know what your spot earned." holds while
the "Owed to you" card lifts.
Engineering: "One booking. Three answers." with three figure cards dropping in one by one.

## Key moments
- The statement row resolving line by line: Base price → ParkEase fee → You earned (highlighted inside the real screen, never restated).
- Earnings switching Today → Week, the chart bars growing (real clip).
- The listing's bookings: who's parked now, who's next (real clip).
- Engineering: four `this.balance.movement(` calls lighting up in sequence — owed, today, month, last month — then the green test named "dashboard and earnings agree on owner earnings".

## Outro / punchline
Consumer end card: "Your spot. Your statement." · "Coming soon to Android".
Engineering end card: "Every figure is one query." · "github.com/Deonkar/parkease".

## User flow worth showing
Dashboard (glance) → statement (line by line) → earnings (over time) → one space's bookings.

## Tone
- Preset: polished
- Creative direction: a bank statement that feels calm, not a fintech ad
- Interpretation: 3–4 scenes, long holds, soft 0.6s crossfades, one idea per scene, mixed case, medium weights.

## Format
- consumer: vertical 1080×1920, 30fps, ~21.6s
- engineering: landscape 1920×1080, 30fps, ~24.4s

## Visual identity (from the project)
- Background `#F8FAFC`, surface `#FFFFFF`, ink `#0F172A`, secondary `#475569`, line `#E2E8F0`
- Accent `#0369A1` (text-bearing), vivid `#0284C7` (large fills only)
- Display + body: Plus Jakarta Sans (series fonts); code: JetBrains Mono
- Strongest visual element: the statement card — Base price / ParkEase fee / You earned

## Share copy (draft)
Consumer: "Every booking on your parking spot, line by line: base, fee, what you earned. ParkEase, coming soon to Android."
Engineering: "ParkEase v1 showed an owner three different earnings for one booking. Now every figure is one ledger query, and a test proves the screens agree."

## Audio direction
- Role: warm bed, sparse professional accents
- Music: consumer `vol-12` (steady and clean, 109.96 BPM); engineering `vol-11` (warm, business-y, 114.84 BPM)
- Music treatment: bed ~0.3, 0.4s fade-in under the sting, 1.2s fade-out into the end card
- Music cue guidance (preset files read): vol-12 strong cues 8.74, 13.11, 17.47, 18.56s — land the statement's "You earned" highlight near 8.74, the Week switch near 13.11, the end card near 18.56–19.0. vol-11 strong cues 5.80/6.34, 8.96/9.50, 12.65s — land the strike-through near 5.80, the first `movement(` highlight near 8.96, the rule scene near 12.65.
- Audio-reactive: none (polished)
- SFX posture: sparse — a soft accent on the pin landing, a gentle drop per statement line, a tick per test line
- Restraint rule: no whooshes, no risers, nothing louder than the bed

## Storyboard — consumer (1080×1920)

### Scene 0 — Sting — 1.8s
Series spine (pin drop, wordmark). Transition: soft crossfade.

### Scene 1 — The glance — 4.5s (1.8 → 6.3)
Phone rises into frame (still `01-dashboard-top`). Caption above: "Know what your spot earned."
Sequential: soft highlight rings the "Owed to you" card, then the Today card.
Audio-coupled: gentle drop on each highlight.
Transition: soft crossfade (same phone, content change).

### Scene 2 — Line by line — 5.2s (6.3 → 11.5)
Phone plays `02-dashboard-to-statement` (3.1s) and holds on `02b-statement`; the camera pushes in on
the first statement card. Caption: "Every booking, line by line."
Sequential: Base price → ParkEase fee → You earned highlighted in turn (inside the screen).
Transition: soft crossfade.

### Scene 3 — Over time — 4.0s (11.5 → 15.5)
Phone on `03-earnings-today`, then plays `03b-earnings-today-to-week`: bars grow.
Caption: "Today. This week. At a glance."
Never the Month tab (S-96).
Transition: soft crossfade.

### Scene 4 — Who's parked — 3.5s (15.5 → 19.0)
Phone plays `04c-listing-bookings`. Caption: "See who's parked, and who's next."
Transition: soft crossfade → end card.

### Scene 5 — End card — 2.6s (19.0 → 21.6)
"Your spot. Your statement." · "Coming soon to Android".

**Total: 21.6s.**

## Storyboard — engineering (1920×1080)

### Scene 0 — Sting — 1.8s

### Scene 1 — Three answers — 4.5s (1.8 → 6.3)
Left: "One booking. Three answers." Sub: "ParkEase v1, one surged booking".
Right: three cards arrive one by one — Dashboard ₹82.47 · Earnings ₹51.00 · Payout job ₹42.50.
Then ₹82.47 and ₹42.50 strike through and fade; ₹51.00 stays, labelled "the ledger's answer".
(Paraphrased engineering history; no doc named.)

### Scene 2 — One query — 6.0s (6.3 → 12.3)
Headline: "Now every figure is one ledger read."
Code panel: `apps/api/src/domains/ledger/queries/owner-dashboard.ts` lines 45–50 and 86, real text.
The four `this.balance.movement(` lines light up in turn with labels owed / today / month / last
month; then line 86 (`isolationLevel: 'repeatable read'`) with "one snapshot".
Right: phone with `01-dashboard-top`.

### Scene 3 — The owner's line — 5.0s (12.3 → 17.3)
Large crop of the real statement card (`02b-statement`): Base price ₹60.00 / ParkEase fee −₹9.00 /
You earned ₹51.00. Text: "Base, minus the 15% fee. Surge never reaches the owner's line."
(15% from `packages/contracts/src/money/rates.ts`.)

### Scene 4 — Proof — 4.5s (17.3 → 21.8)
Terminal panel: real vitest output from `captures/test-owner-dashboard-http.txt`, lines ticking in;
"dashboard and earnings agree on owner earnings" held and highlighted.

### Scene 5 — End card — 2.6s (21.8 → 24.4)
"Every figure is one query." · "github.com/Deonkar/parkease".

**Total: 24.4s.**

**Music mood:** calm, confident. **Audio summary:** a steady bed that lets each figure land with one soft accent.

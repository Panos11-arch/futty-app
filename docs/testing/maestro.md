# End-to-end tests with Maestro

Three user journeys run as [Maestro](https://docs.maestro.dev) flows on an iPhone simulator and an Android emulator, in Expo's cloud workflows ([EAS Workflows, E2E tests](https://docs.expo.dev/eas/workflows/reference/e2e-tests/)). They run against the **staging** Supabase project, with Stripe in **test** mode. They never touch production.

| Where | What |
| :---- | :---- |
| `.maestro/flows/` | The three journeys |
| `.maestro/subflows/` | Shared steps: sign in, open a tab, open my booking, pay with the Stripe test card |
| `.maestro/config.yaml` | Runs `flows/` in order and stops at the first failure |
| `.eas/workflows/e2e.yml` | The Expo workflow |
| `scripts/e2e-seed/` | Resets and creates the e2e data on staging |
| `lib/e2e-guard.ts` | Refuses production and live Stripe keys |
| `tests/maestro/` | Jest checks of the flows and the workflow, run in CI with no device |

## Safety

- **Never production.** `lib/e2e-guard.ts` throws if a Supabase URL contains production's project ref (`ospztpemchfpvvostisw`), if a legacy JWT key belongs to production, or if a Stripe key starts with `sk_live_`, `pk_live_` or `rk_live_`. The seed calls it before it connects to anything. The workflow's first job runs the same checks on eas.json's `e2e-test` profile. `lib/e2e-guard.test.ts` checks that profile in every CI run.
- **No secret in the repo.** The staging URL, its anon key (a legacy anon JWT or a new `sb_publishable_` key) and the `pk_test_` key are public values, and they go in eas.json. The service-role key (a legacy `service_role` JWT or a new `sb_secret_` key), the `sk_test_` key and the e2e password exist only as secret variables in Expo.
- **Only e2e data.** The seed selects only the four `@e2e.futty.app` logins and their own bookings at the "E2E Arena" venue. Its league and teams have fixed ids and e2e names, and the seed stops if one of those ids holds anything else. Leftover bookings are cancelled through the app's own path (`cancellation_quote`, then `cancel-booking`, signed in as their booker), so Stripe and the money ledger stay right. Money rows are never deleted.
- **A guard inside the app.** The `e2e-test` profile sets `EXPO_PUBLIC_E2E=1`. With that flag, `lib/supabase.ts` throws before it creates the client if the Supabase URL is production's or the Stripe publishable key is `pk_live_`. So an e2e build can't talk to production even if Expo's preview environment overrides the values in eas.json. Other builds don't have the flag, so nothing changes for them. The workflow's first job fails if the profile doesn't set the flag.
- **A second safety net.** The e2e logins exist only on staging. If a build ever pointed at production, the sign-in flow would fail before anything could be booked.

## What each flow checks

Each flow takes a screenshot at the end (`sign-in-ios.png`, `book-and-pay-android.png`, and so on). The screenshots are in the job's "Maestro Test Results" artifact.

1. **`sign-in`**: signs in with email and password and sees Home and the tab bar. The starting-level questions are skipped when they show (every run is a new device).
2. **`book-and-pay`**: on Book a pitch (S4), picks 5-a-side (Format chip), the seeded day alone (Date chip: the seeded day on, today off; the seed puts the slot 2 days after today), Evening (Time chip) and 60 minutes (Filters), then taps E2E Arena's seeded start time on its card (`book-venue-<id>-time-<day>-<start>`; the card itself opens the venue page). At checkout (Booking v2), once the weather strip has settled, it taps the first free pitch (`checkout-pitch-1`), then **Whole pitch** (`checkout-kind-whole`), then **Pay for everyone** (`checkout-who-pay-all`), and checks that the button says **Pay €65.50**. After paying it lands on the screen after paying (B3: invite friends, the opposition, publish) and taps **Go to booking** (`after-pay-done`). That is spec 13's worked example: a €60 5-a-side where the booker pays for everyone, €60 + 10 × €0.55. It pays in Stripe's sheet with the test card 4242 4242 4242 4242, expiry 12/34 and CVC 123. It then waits for the booking to show **confirmed**. Only Stripe's webhook sets that status, and the booking screen doesn't refresh by itself, so the flow reopens the booking from Profile > My bookings up to 6 times (about 3 minutes). That also checks that the booking is listed in My bookings.
3. **`cancel`**: opens that booking and taps "Cancel whole team". The booker paid for everyone, and spec 13 says that booker can only cancel the whole booking. The flow checks the quote's exact words before confirming:
   - "The booking is cancelled and the pitch is released."
   - "You get €65.50 back. The hold on your card is released."

   This is spec 13's free hour: the booking was paid minutes ago and is more than 6 hours before kickoff, so the €65.50 hold is released. After the second tap the flow checks "The booking is cancelled." and "This booking was cancelled." Run it straight after `book-and-pay`. An hour later the quote is different, and so is what this flow expects.
4. **`book-missing-venue`** (S4): on Book a pitch, opens "Where do you want to play?", types a venue Futty doesn't have, taps **Missing a venue?** and sends its name and town. The server takes 5 a player a day, so a second run on the same day may see "You’ve sent 5 today. Try again tomorrow." instead of "Venue sent"; either one passes.

4. **`log-score`** (S13B): Home shows "Log the score" for the seeded game (a pickup this login booked, played 2 hours ago). It taps **Log**, sets Bibs 1, Non-bibs 0, gives the goal to this login on the pitch, continues past Assists (optional) and confirms on Review. One captain, so the score is final: the match page shows "Bibs 1–0 Non-bibs".

5. **`block-clashes`** (doc 28 prompt 1): signs in as the platform's venue-staff login, opens Account > Venue dashboard, moves to tomorrow and taps **Block**, picks the staff venue's pitch and taps **Block pitches** (whole day). The clash sheet (`clash-sheet`) lists the seeded phone booking before anything is saved: "21:00–22:00 · E2E Caller" and "Phone · +35799000000 · Not paid". **Block and cancel** saves the block and cancels the booking (`venue_add_block`); then "Call them" names the contact and phone, and **Done** closes it. Nothing was paid, so no money moves.
6. **`community`** (S7): opens the Community tab (image 18), checks For you and Your posts, opens Following, taps Search (Find players with the search field and "From your contacts"), flips Players | Teams, and opens the + sheet's New team form. It creates nothing.
7. **`competition`** (S10): opens Leagues > the city group "E2e" > 5-a-side, the seeded league "E2E City 5s", and walks every tab of its competition page. **Overview**: the season card, Player of the season, Team of the season and the featured upcoming game. **Matches**: the fixtures. **Standings**: this login's own row in the Short, Full and Form views. **Player stats**: the tab opens; it is Premium, so a standard login sees the Get Premium card. **Stats**: the Goals card. **Power rankings**: the list. The star pins the league, then unpins it. The power rows are optional: see "The seed data".

`tests/maestro/flows.test.ts` checks these words and amounts against the app's own code (`describeQuote`, `cancelledMessage`, `payLabel`). The quote it checks is one `cancellation_quote` returned on a local database. The same test fails if a flow uses a testID the app doesn't have.

### The seed data

`scripts/e2e-seed/seed.ts` resets and creates the e2e data on every run:

- **Logins:** four confirmed player logins with the password from `STAGING_E2E_PASSWORD`: `e2e-ios-1`, `e2e-ios-2`, `e2e-android-1` and `e2e-android-2` @e2e.futty.app. Each platform uses its own `-1` login.
- **Venue:** "E2E Arena" with a fixed id, live, open 07:00 to midnight every day.
  - Two 5-a-side pitches.
  - One price, €60. That's spec 13's €60 5-a-side.
- **Stripe:** a Stripe TEST connected account for the venue, created like `connect-onboarding` creates one (an Express account with the same parameters and idempotency key), and kept once it exists.
- **A game to log (S13B):** per platform, a pickup at E2E Arena played 2 hours ago and waiting for its score, with fixed ids (`E2E_LOG_MATCHES` in `scripts/e2e-seed/config.ts`): the `-1` login captains Bibs, the `-2` login plays Non-bibs. It is deleted and made again on every run.
- **Venue staff (doc 28, `block-clashes`):** two more logins, `e2e-ios-staff` and `e2e-android-staff` @e2e.futty.app, set to `venue_owner`. Each owns its own venue ("E2E Staff Arena iOS" / "E2E Staff Arena Android", fixed ids, not live, so players never see them in Book) with one 5-a-side pitch, the same hours and price. On every run the seed clears that venue's blocks, cancels any walk-in a run left open (as staff, `cancel_counter_booking`; never paid, so no money row) and adds a phone booking for tomorrow in Cyprus, 21:00–22:00, contact "E2E Caller", not paid (`E2E_STAFF` and `E2E_STAFF_BOOKING` in `scripts/e2e-seed/config.ts`). A run that crosses Cyprus midnight between the seed and the flow would look at the wrong day.
- **A live league (S10, `competition`):** the city league "E2E City 5s" in its own e2e-only city (scope `E2E`; the Leagues list shows the group as "E2e"), fixed id (`E2E_LEAGUE` in `scripts/e2e-seed/config.ts`). It has four teams, "E2E iOS 1 FC", "E2E Android 1 FC", "E2E iOS 2 FC" and "E2E Android 2 FC" (`E2E_TEAMS`), each captained by one player login, which is its only player.
  - On the first run the teams sign up and `league_start_season` starts "Season 1" (a child row, as in production). The league stays in sign-up, as a city league does while its season runs.
  - Every pairing is played once (`E2E_LEAGUE_RESULTS`), 3 days apart from 21 days before that first run: each team plays 3 games. The seed confirms each league match, checks in its players and writes the goals and ratings. Then `apply_match_levels` makes it final, which completes the fixture, so the standings, stats and awards have data. These games move the e2e logins' levels.
  - A second run finds Season 1 and its completed fixtures and changes nothing; a run that stopped halfway finishes the rest.
  - On every run, the upcoming fixture (Android 1 at home to iOS 1, the reverse of their first game) moves to 3 days ahead at 20:00 Cyprus time, and its match follows.
  - The power ranking isn't made by the seed. `power_ranking_tick` can't run through the API, because Supabase's `pg_safeupdate` refuses its unqualified `DELETE`. Staging's `match_jobs_tick` job (every 15 minutes) picks the results up, so on the very first run after the league is created the power ranking can be empty for up to 15 minutes. That is why `competition` checks its rows as optional.
  - The guards: the seed stops if the league's id holds another league, or a team id another team.
- **The slot:** two days after today in Cyprus (Asia/Nicosia), at 19:00 on iOS and 20:00 on Android. That is more than 6 hours ahead (so there is a free hour) and inside the 7-day booking window. iOS and Android use separate logins and separate hours, so both can run at once. `book_slot` picks the pitch, and two pitches leave room if a run left a booking behind.

## Setting up staging (once, Panos)

Panos does all of this. Nothing in this repo runs a command against a remote project.

1. **A staging Supabase project:** apply the migrations to it and deploy the Edge Functions to it. Give the functions Stripe **test** secrets (`STRIPE_SECRET_KEY=sk_test_...` and the test webhook's signing secret).
2. **Stripe test mode:** add a webhook endpoint pointing at staging's `stripe-webhook`, with the same events production uses, and switch Connect on.
3. **Expo secrets:** in the Expo project's **preview** environment, add these as **secret** variables:
   - `STAGING_SUPABASE_URL`
   - `STAGING_SUPABASE_SERVICE_ROLE_KEY`
   - `STAGING_STRIPE_SECRET_KEY`
   - `STAGING_E2E_PASSWORD` (at least 8 characters)
4. **eas.json:** in the `e2e-test` profile, replace `REPLACE_STAGING_URL`, `REPLACE_STAGING_ANON_KEY` and `REPLACE_PK_TEST` with staging's public values. Until then the workflow stops at its first job and says which placeholder is left.
5. **Check the first build points at staging.** Build profiles also load the variables of their EAS environment. Make sure the preview environment's own `EXPO_PUBLIC_SUPABASE_URL` doesn't override the profile's (the [environment variables docs](https://docs.expo.dev/eas/environment-variables/) explain which value wins). If it overrode it with production's, the app's runtime guard stops it at launch. If it overrode it with another project, sign-in fails, because the e2e logins exist only on staging.

The `e2e-test` profile builds a simulator app for iOS and an APK for Android, with internal distribution, no update channel and no credentials. It adds no native code, so no new development build is needed.

## Running

**On Expo:**

```
eas workflow:run .eas/workflows/e2e.yml
```

It runs only by hand, never on a pull request or a push. The jobs run in this order:

1. `check_config` checks the e2e-test profile.
2. `seed` (resets staging's e2e data) runs alongside `build_ios` and `build_android`.
3. `maestro_ios` and `maestro_android` run the flows.

**Locally on an Android emulator (optional):**

1. Install Maestro (`curl -fsSL "https://get.maestro.mobile.dev" | bash`) and start an emulator.
2. Build and install the app against staging: `eas build -p android --profile e2e-test`, then install the APK. A local `npx expo run:android` also works, with the three `EXPO_PUBLIC_` values set to staging's.
3. Seed staging. This writes to staging, so check the values first:

   ```
   STAGING_SUPABASE_URL=... STAGING_SUPABASE_SERVICE_ROLE_KEY=... STAGING_STRIPE_SECRET_KEY=sk_test_... \
   STAGING_E2E_PASSWORD=... npx --yes tsx@4.20.6 scripts/e2e-seed/seed.ts
   ```

   It prints the slot, for example `{"slot_day":"2026-11-23","ios_start":"19:00","android_start":"20:00",...}`.
4. Run the flows:

   ```
   maestro test .maestro -e MAESTRO_E2E_PLATFORM=android -e MAESTRO_E2E_PASSWORD=... \
     -e MAESTRO_E2E_DAY=2026-11-23 -e MAESTRO_E2E_START=20:00
   ```

**The seed without staging:** `scripts/e2e-seed/seed.ts --local` runs against a local stack at `http://127.0.0.1:54321` only, with a fake Stripe. Start the stack with `npx supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`. Cancelling a leftover booking needs the Edge Functions, so locally that step stops with an error.

## Adding a flow

1. Write it in `.maestro/flows/<name>.yaml`:
   - `appId: com.panosalepis.futtyapp`.
   - Its environment taken from `MAESTRO_E2E_PLATFORM`, as the other flows do.
   - It signs in with `../subflows/sign-in.yaml`.
   - It ends with `- takeScreenshot: <name>-${PLATFORM}`.
2. Add `<name>` to `flowsOrder` in `.maestro/config.yaml`.
3. Add the file to the list in `tests/maestro/flows.test.ts`.
4. Select by `id:` (testID) wherever you can. Use on-screen text only for Stripe's own sheet and for the words a flow exists to check.
5. If the flow needs data, add it to the seed: fixed ids, tagged as e2e, never a real user's rows.

### Rules

- **Every new button gets a testID**, in kebab-case `screen-element` form (`checkout-pay`, `booking-detail-cancel-whole-team`). A list item adds its id (`free-venue-<venue id>`). The components in `components/ui` take a `testID` (and `actionTestID`, a segment's `testID`, a sheet action's `testID`). A testID changes nothing on screen.
- **Every PR updates the flows it affects.** A PR that renames or removes a testID a flow uses, or changes words a flow checks, updates the flow in the same PR. `tests/maestro/flows.test.ts` fails in CI if it doesn't.

## When a run fails

These are the places most likely to need tuning on the first runs:

- **Stripe's sheet** (`subflows/stripe-test-card.yaml`): its field labels differ by Stripe SDK version and the simulator's region (the postal code field). The checkout's own "Pay €65.50" button sits under the sheet with the same words, and the flow relies on the sheet being on top.
- **The webhook:** if staging's webhook endpoint or signing secret is wrong, the booking never turns confirmed, and `book-and-pay` fails after about 3 minutes.
- **A leftover booking:** if a run stopped after paying, the next seed cancels that booking as its booker. If it can't, the seed stops and names the booking.
- **Two runs at once** from different branches share the e2e logins, so one can cancel the other's booking. Start one run at a time. A newer run from the same branch cancels the older one.

## Cost

Prices are from [expo.dev/pricing](https://expo.dev/pricing), read on 21 November 2026. Jobs other than builds are billed per minute. Every run builds both apps.

| Job | Machine | Price | About |
| :---- | :---- | :---- | :---- |
| `build_ios` | iOS medium | $2 per build | $2.00 |
| `build_android` | Android medium | $1 per build | $1.00 |
| `maestro_ios` | `macos-medium` | $0.075 a minute, plus $0.05 a job | ~15 min, $1.20 |
| `maestro_android` | `linux-medium-nested-virtualization` (the cheapest that runs an emulator) | $0.020 a minute, plus $0.05 a job | ~15 min, $0.35 |
| `check_config`, `seed` | `linux-medium` | $0.018 a minute | ~5 min, $0.10 |
| **Total** | | | **about $4.65 a run** |

It runs only when someone starts it, so nothing is spent on ordinary pull requests. Run it before a release, or on a PR that changes a journey. Build credit included in the Expo plan is used first.

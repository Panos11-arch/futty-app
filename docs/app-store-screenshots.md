# App Store screenshots

U8 (docs/specs/17-ui-prompts.md, step 5): screenshots of Home, Book, the venue page, checkout, Play and Profile, taken from **seed data only**. That means no real players, venues or payments, and never production.

## The seed is local only

All the content comes from `supabase/seed.sql`, and everything in it is made up: `@futty.test` users with a shared local password, "Test Arena North" and "South", two teams, one booking and fake Stripe ids (`pi_seed_…`). It can't reach production:

- Only `npx supabase db reset` and the first `npx supabase db start` load it. That's the local stack (and CI's).
- `supabase db push` applies migrations only. It loads a seed only with `--include-seed`, and `tests/guards/seed-local-only.test.ts` fails if that flag appears in any script, workflow or doc.
- As a last guard, the seed's first statement stops it on any database that already has users.

## 1. Fresh local data

The booking is dated **two days after the reset**, at 19:00 Cyprus time. Reset on the day you take the screenshots, so it still shows as the next game:

```sh
npx supabase start          # if it isn't running
npx supabase db reset       # migrations, then supabase/seed.sql
```

What player1 then has:

| Screen | Seed content |
| --- | --- |
| Home | Next game at Test Arena North, 19:00 in two days, 5-a-side. player1 and player2 have paid (card held), player3 hasn't. A "Need players: 2" post for it. |
| Book | Test Arena North (Nicosia) and Test Arena South (Limassol), with free times |
| Venue page | Test Arena North |
| Checkout | Any free slot at Test Arena North. **Stop on the checkout screen; don't pay.** |
| Play | Teams: Nicosia Rovers (player1 captain, player2, player3). Matches: Rovers 4–2 Strovolos United, three days ago. |
| Profile | Test Player One |

Prices are the server's own, from the venue's €60 price: €6.80 a player (spec 13's example).

## 2. Point the development build at the local stack

The phone has to reach your computer, so use its LAN address, not `127.0.0.1`. Only edit your own `.env`, and never commit it:

```sh
EXPO_PUBLIC_SUPABASE_URL=http://<your computer's LAN IP>:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status`>
```

The phone and computer must be on the same Wi-Fi. On Windows, allow inbound TCP 54321 in the firewall for the private network. Then run `npx expo start --clear` and open the development build.

Sign in as **player1@futty.test** with password **password123** (local only).

Put your own `.env` back when you're done.

## 3. Capture

Take them on an iPhone whose screenshots come out at a size App Store Connect accepts. Portrait, with the device's own screenshot buttons:

| Display | Pixels (portrait) | Devices | |
| --- | --- | --- | --- |
| 6.9" | 1320 x 2868 (or 1290 x 2796) | iPhone 16 Pro Max, 15 Pro Max, 15 Plus, 16 Plus | Required |
| 6.5" | 1242 x 2688 (or 1284 x 2778) | iPhone 11 Pro Max, XS Max, 12/13/14 Pro Max, 14 Plus | Only if you don't upload 6.9" |

App Store Connect scales the 6.9" set down to every smaller iPhone. Check the current list in App Store Connect → the version → Previews and Screenshots before uploading.

Order: **Home, Book, Venue page, Checkout, Play, Profile.** Before each one:

- Settings → Display & Brightness → Text Size at the default (not Larger Text).
- Light mode. Full battery or charging. No notifications showing. Do Not Disturb on.
- The release checklist's location wording applies: no "near you" captions.

Save them in the team Drive (not the repo), named `01-home.png` … `06-profile.png`.

## Not covered here

- **iPad.** `app.json` has `"supportsTablet": true`, so App Store Connect will also ask for 13" iPad screenshots (2064 x 2752 or 2048 x 2732). That's a decision for the release (P7): turn tablet support off, or take iPad screenshots the same way.
- **Venue photos.** The seed venues have none, so cards show the initials placeholder. Add photos through the venue dashboard as staff@futty.test (password123) before capturing if you want them.

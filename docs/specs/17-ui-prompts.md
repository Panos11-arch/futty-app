# 17 Futty – UI Redesign Prompts

7 November 2026 · Run by Anghelo (from 9 November; order and waits in 14, "Who runs what") · Implements every part of 15 Design Brief

**Nine prompts turn the app into the calm, professional look in 15: tokens and fonts first, then the component library, navigation, Home, and every remaining screen.** The booking screens, the venue page and the venue dashboard aren't restyled here: P5, P9 and P6 in 14 rebuild them with the same components, so they come out in the new look. Run these exactly like the prompts in 14: one prompt, one pull request, tests included, CI green before merging.

## Where each part of 15 is built

| Part of 15 | Built in |
| --- | --- |
| 3 Colour, type, space, shape, depth | U0 |
| 3 Icons, imagery, motion, loading, words | U1 (components), then every screen prompt |
| 4 Navigation (four tabs, notifications bell) | U2 |
| 5 Home | U3 |
| 5 Book, Checkout, Booking detail, Debt and credit | P5 (14) |
| 5 Venue page | P9 (14) |
| 5 Venue dashboard | P6 (14) |
| 6 Components | U1 |
| Play, profile, account, sign-in and the other screens | U4–U7 |
| Checks that keep it this way | U8 |

## Order

| # | Prompt | Needs | Hours | When |
| --- | --- | --- | --- | --- |
| 1 | U0 Design tokens and fonts | S0 | 3 | Now |
| 2 | U1 Component library | U0, T0 (Jest) | 6 | Now |
| 3 | U2 Navigation: four tabs | U1 | 3 | Now |
| 4 | U3 Home | U2 | 3 | Now |
| 5 | U4 Play section | U2 | 6 | Next |
| 6 | U5 Profile, account and Premium | U2, P5, P10 | 4 | Next |
| 7 | U6 Sign-in and onboarding | U1 | 2 | Next |
| 8 | U7 Squads, posts and pop-ups | U1, P5 | 3 | Next |
| 9 | U8 Final sweep and guards | U3–U7, P5, P6, P9 | 3 | Next, before the App Store screenshots |

**Before U4–U7:** put the 12 Playtomic screenshots from 15 section 7 in Drive and attach the relevant ones to each session.

**Every UI change is JavaScript only** (Inter is already installed through @expo-google-fonts/inter), so check each prompt on your phone with `npx expo start` and the development build you have. No new EAS build is needed, except for U6's splash screen and app icon, which wait for the next release build (P7).

## Rules that apply to every prompt below

Paste this block at the start of each U prompt:

```
Read docs/specs/15-design.md first; it is the source of truth for every visual decision. Rules: change how screens look, never what they do (same data, same navigation targets, same server calls); use only components/ui and the tokens in constants/futty-theme.ts (no hex colours, numeric font sizes, radii, shadows or emoji in screens); every screen has a loading skeleton, an empty state and an inline error with retry; sentence case, no exclamation marks, never "authorize", "capture" or "void"; money is shown exactly as the server returns it, with € and two decimals; touch targets at least 44 x 44; every icon-only button has an accessibilityLabel; text must not clip at Dynamic Type XL. Read https://docs.expo.dev/versions/v55.0.0/ before using any Expo API. Only touch the files this prompt names. Plan first.
```

---

## U0 Design tokens and fonts

```
Implement docs/specs/15-design.md section 3 as the single source of design tokens.

1. Rewrite constants/futty-theme.ts to export:
   - colors: ink #0B1215, inkMuted #5B6470, surface #FFFFFF, canvas #F4F5F7, border #E4E7EB, brand #0E5A3A, brandSoft #E7F1EC, success #1F7A45, warning #8A5C00, danger #B42318, plus onBrand #FFFFFF for text on brand buttons;
   - type: display 28/34 700, title 22/28 700, headline 17/22 600, body 15/20 400, callout 13/18 500, caption 12/16 500, each with the matching Inter family (Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold), and a tabular variant (fontVariant ['tabular-nums']) for prices, times and scores;
   - space (4, 8, 12, 16, 24, 32), radius (card 12, control 10, pill 999), shadow (offset y 2, blur 8, 6% black; one shadow token only), hairline (StyleSheet.hairlineWidth).
2. Keep every existing export name (FuttyColors.emerald950, stone900 and the rest, FuttyFonts, FuttyNavigationTheme) working by mapping it to the nearest new token, with a @deprecated comment, so no screen breaks today. U8 removes them.
3. constants/theme.ts: Colors.light and Colors.dark both use the new tokens (the app keeps one fixed light look).
4. app/_layout.tsx: load the four Inter weights only; stop loading Archivo Black; keep IBM Plex Mono for codes. components/themed-text.tsx: map its existing type props to the new scale.

Tests (Jest): every text/background pair the brief uses (ink, inkMuted, brand, success, warning and danger on surface and canvas; onBrand on brand) has a WCAG contrast ratio of at least 4.5, computed in the test; the deprecated names resolve to the new values; ThemedText renders each type with the right size, line height and family.
```

## U1 Component library

```
Build every component in docs/specs/15-design.md section 6 in components/ui/, using only U0's tokens:
Button (primary, secondary, destructive, plain; loading and disabled; full-width option), IconButton, TextField (label, helper, error), ListRow (title, subtitle, leading icon or avatar, trailing accessory, chevron), SegmentedControl, Chip (selectable), Card, VenueCard (16:9 photo with a neutral initials placeholder when there's no photo, name, area, price per player, next free times as chips), StatusPill (paid, cash, unpaid, debt, confirmed, pending), AvatarStack (overflow "+3"), PriceBreakdown (lines of label and cents from the server, a total line), StickyActionBar (total plus primary button, safe-area aware), Banner (info, warning, danger, optional action), EmptyState (icon, one line, one action), Skeleton (block and text-line shapes), Sheet (bottom sheet), SectionHeader.

Icons go through components/ui/icon-symbol (SF Symbols on iOS, Material on Android). Primary actions give a light haptic tap (expo-haptics). Animations are 200-250 ms and respect Reduce Motion.

Add a component gallery screen at app/dev/components.tsx that renders every component in every state, reachable only when __DEV__ is true, so the look can be checked on the phone.

Tests (Jest + @testing-library/react-native): each component renders each state; Button doesn't fire onPress while loading or disabled; PriceBreakdown shows 680 as "€6.80" and sums nothing itself (it shows the server's total); VenueCard shows initials when there's no photo; every IconButton requires an accessibilityLabel (TypeScript and a test); no file in components/ui contains a hex colour, a numeric fontSize or an emoji (a test reads the files).
```

## U2 Navigation: four tabs

```
Implement docs/specs/15-design.md section 4 in app/(tabs)/_layout.tsx and the tab screens.

1. Four tabs, in this order: Home (app/(tabs)/index.tsx), Book (a new app/(tabs)/book.tsx that shows the current booking start screen by reusing app/book.tsx's content, not a copy), Play (a new app/(tabs)/play.tsx with a SegmentedControl: Teams, Matches, Leagues, Community, which renders the existing team, upcoming-fixtures/previous-games, leagues and community content), Profile (app/(tabs)/profile.tsx).
2. Remove team, leagues and community as separate tabs, but keep their routes working: any link or push notification that opens /team, /leagues or /community lands on Play with the right segment selected (expo-router redirects).
3. Tab bar: SF Symbol / Material icons, labels in caption style, brand colour only for the selected tab, haptic on tab press (components/haptic-tab.tsx), safe-area aware.
4. Home header: large title on iOS and a bell IconButton that opens app/notifications.tsx, with an unread dot when there are unread notifications.

Tests: the tab bar renders exactly four tabs with these labels; /team, /leagues and /community resolve to Play with the matching segment; the bell opens notifications and shows the dot only when unread > 0.
```

## U3 Home

```
Rebuild app/(tabs)/index.tsx to docs/specs/15-design.md section 5 (Home), using the same data hooks it uses today:
- Next game card: venue photo, day and time in Cyprus time, format, who's in (AvatarStack), who hasn't paid (StatusPill), tap opens My Bookings. When P5's <NextBookingCard /> exists in components/booking/, use it instead; until then build components/booking/next-game-card.tsx with the same props so P5 can replace it.
- A Banner slot at the top for anything owed (debt or failed payment). Leave it empty for now; once P5 is merged, connect it to useOwed() from lib/use-owed.ts. No fake data.
- Quick actions: Book a pitch, Find a game.
- Venues nearby as VenueCards in a horizontal list.
- "Need players" games from the existing squad posts hook, as ListRows with level and time.
- A weather chip slot on the next game card, hidden until P11.
- Skeletons while loading, an EmptyState when there's no next game ("No games booked" + Book a pitch).

Tests: each state renders (loading, empty, with a game, with an owed banner); times render in Cyprus time whatever the phone's time zone (set TZ in the test); no hard-coded colours or font sizes in the file.
```

## U4 Play section

```
Restyle the Play content to docs/specs/15-design.md without changing behaviour: app/(tabs)/team.tsx, app/(tabs)/leagues.tsx, app/(tabs)/community.tsx (now shown inside Play), app/upcoming-fixtures.tsx, app/previous-games.tsx, app/fixture-confirmed.tsx, app/fixture-chat.tsx, app/matchmaking.tsx, app/team-profile.tsx, app/player-profile.tsx, and the components they use: fixture-confirmed-card, fixture-score-form, booking-result-form, add-player-row, chip.
- Teams, fixtures and results as Cards and ListRows; scores and times in tabular figures; league tables with clear column alignment and the user's team highlighted with brandSoft.
- Replace components/pitch-background.tsx (the drawn pitch) with a plain canvas background and delete the component when nothing uses it.
- Community feed: avatar, name, time, text, one row of actions; no coloured category icons.
- Chat: standard bubbles (surface for others, brandSoft for mine), timestamps in caption style.

Tests: snapshot per screen state (loading, empty, populated); league table highlights the user's team; no hex colours, numeric font sizes or emoji in these files.
```

## U5 Profile, account and Premium

```
Restyle to docs/specs/15-design.md without changing behaviour: app/(tabs)/profile.tsx, everything in app/account/ (index, activity/*, help, how-it-works, payments/*, premium, privacy-policy, settings/*, terms), app/premium-plan.tsx, app/notifications.tsx, app/edit-profile.tsx, and components menu-row.tsx, doc-screen.tsx and futty-ai-chat.tsx.
- Profile: avatar, name, level badge, stats in a row of small tiles (tabular figures), then ListRow groups (My bookings, Payments, Settings, Help).
- Account and settings: grouped ListRows with SectionHeaders, iOS-style.
- Payments and transactions: amounts right-aligned in tabular figures, StatusPill for each state, money wording from section 3 ("held", "charged", "released").
- Premium: one Card with the price from the App Store, the two benefits in plain words (book 14 days ahead instead of 7; no service fee on your own spot), one primary Button. No badges, confetti or emoji.
- Notifications: ListRows with an unread dot, grouped by Today / Earlier.
- Futty AI chat: same bubble style as U4's chat.

Tests: snapshot per screen state; Premium shows the price passed in from the store (not a hard-coded €4.99 or €3.99); transactions render server amounts unchanged.
```

## U6 Sign-in and onboarding

```
Restyle to docs/specs/15-design.md without changing behaviour: app/sign-in.tsx, app/forgot-password.tsx, app/reset-password.tsx, app/confirm-email.tsx, components/auth-form.tsx, components/phone-field.tsx, components/lock-screen.tsx. Remove components/hello-wave.tsx (the waving-hand animation) and anything that uses it.
- One column, the Futty wordmark in ink (no illustration), TextFields with labels and inline errors, one primary Button, plain links.
- Prepare a new splash screen (canvas background, wordmark) and app icon in assets/, and the app.json change, in a separate commit marked "needs a new build", so it ships with P7's release build.

Tests: each form shows inline errors for empty and invalid input; the submit Button shows loading and can't be pressed twice.
```

## U7 Squads, posts and pop-ups

```
Restyle to docs/specs/15-design.md without changing behaviour: app/squads.tsx, app/join-squad-post.tsx, app/modal.tsx, and components popup-modal.tsx, wizard-modal.tsx, parallax-scroll-view.tsx, icon-label.tsx, external-link.tsx.
- "Need players" and "Need opposition" posts as Cards: venue, day and time, format, level, spots left, price per player from the server, one action.
- Pop-ups become Sheets (bottom sheets) with a title, short text and at most two Buttons; wizards show progress as "Step 2 of 3" text, not coloured dots.
- Remove the parallax header; use a plain large title.

Tests: snapshot per state; join-squad-post shows the server's price unchanged; a Sheet closes on the secondary Button and on swipe down.
```

## U8 Final sweep and guards

```
Make the new look impossible to drift from:
1. A Jest test that scans app/ and components/ (except constants/ and components/ui/) and fails on any hex colour, rgb() colour, numeric fontSize, numeric borderRadius, shadow* style or emoji.
2. Remove the deprecated token names U0 kept, and fix every remaining use.
3. A copy check that fails if any screen string contains "authorize", "capture", "void", "Submit" or an exclamation mark.
4. Accessibility: every Pressable and IconButton has an accessibilityLabel or visible text; check every screen at Dynamic Type XL and fix clipping; touch targets at least 44 x 44.
5. Produce App Store screenshots, at the iPhone sizes App Store Connect asks for, of Home, Book, the venue page, checkout, Play and Profile, using seed data only.

Tests: the scans above run in CI and pass.
```

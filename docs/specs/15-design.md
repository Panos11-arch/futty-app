# 15 Futty – Design Brief

7 November 2026 · Owner: Anghelo runs the UI prompts in 17 (from 9 November); Panos's booking, venue and dashboard screens use the same components · The Claude Code prompts that build this are in 17 UI Redesign Prompts

**Futty should look like a calm, professional booking tool: lots of white space, one brand colour, real photos, clear prices, no decoration.** Playtomic is the reference for structure and tone. We borrow how its screens are organised, never its logo, colours, illustrations or wording.

> **Updated 24 November (S0).** Section 0 below is the redesign decided on 19–20 November (with the additions of 22 November) and wins over sections 1–7 wherever they differ. Sections 1–7 are the 7 November brief: they still apply where section 0 says nothing. The sections it replaces are marked "Replaced". Rules on money and bookings still come from 13; section 0 never changes them.

## 0. Navigation, layout and design system (decided 19–20 November)

Goal: Futty is the simplest, smoothest football app in Cyprus. A player can book a pitch, check fixtures and leagues, message someone, or look up a team or player in as few taps as possible. Booking v2 (13) is already built: the redesign restyles its screens and never changes its rules.

### 0.1 References and the agreed screens

- **Agreed screens (decided 22 November):** the folder "Futty App Screens" (one image per screen, with a README listing each image's prompt and owner). They decide layout, section order, words, buttons, tabs and states. Names, scores, prices and amounts in them are sample data; `[PRICE]`, `[AMOUNT]` and `[TIME]` are placeholders for real venue data. They win over the references; 13, this spec and each prompt's own text win on rules and amounts.
- **References:** the folder "futty-design-refs". Playtomic for booking, venues, Home, community and profile; SofaScore for leagues, competitions and Team of the Week. Navigation, layout and flows follow them closely, in Futty's own style and colours.
- Neither folder is ever copied into the repo. Each pull request lists the images it followed.

### 0.2 Colour (replaces the colour table in section 3)

Every colour is a token in `constants/futty-theme.ts`, with a light and a dark value. Screens never hard-code a colour.

| Token | Light value | Used for |
| --- | --- | --- |
| `green` | #00FF9C | Primary buttons, selected tabs, chips and toggles, active states, the "W" form circle |
| `greenInk` | #03140C | Text and icons on green |
| `night` | #05100B | Dark panels: player card top, league and Team of the Week headers, the pitch surround |
| `ink` | #0B1215 | Main text |
| `muted` | #5B6470 | Secondary text |
| `canvas` | #F4F5F7 | Screen background |
| `surface` | #FFFFFF | Cards |
| `border` | #E4E7EB | Hairlines, card borders, dividers |
| `greenSoft` | rgba(0,255,156,0.12) | Selected backgrounds |
| `warning` / `warningLight` | #8A5C00 / #FFF6DA | Warnings |
| `danger` | (kept from section 3: #B42318) | Errors and the "L" form circle |
| grey | (a neutral grey token) | The "D" form circle |

- **Never green as text or thin icons on white or canvas** (contrast). Green text only on `night`.
- **Light and dark mode** (decided 22 November): every token has a dark value too (a `night` background; green is allowed as text only on dark). Settings → Appearance: System (default), Light, Dark, stored on the phone. The dark values are set in S1 and shown in images 26 and 27.
- Everything still passes WCAG AA (section 3).

### 0.3 Type (replaces "One family: Inter" in section 3)

- **Cairo** for headings, numbers on cards and the wordmark; **Inter** for everything else. Both through `@expo-google-fonts`. **Archivo Black is removed.** IBM Plex Mono stays for codes only.
- Spacing, radius and the type scale are tokens in `constants/futty-theme.ts`. No hard-coded colours, sizes or emoji anywhere.

### 0.4 Accessibility settings (Settings → Accessibility, applied app-wide through the theme)

- **Text size:** follows the phone's text size, plus an in-app slider up to 200%. Layouts never clip.
- **Dyslexia-friendly font:** open licence, bundled.
- **Bold text.**
- **High contrast.**
- **Reduce motion:** no animations, and the Home banner stops rotating. It also follows the phone's setting.
- **Colour-blind friendly results:** results always show W/D/L letters and shapes, never colour alone.
- **Haptics:** on or off.

### 0.5 Navigation (replaces section 4)

- **A tab bar fixed at the bottom of every screen** with five items: **Home · Community · Card · Rankings · Profile**. Book and Play stop being tabs; everything in them stays reachable (section 0.9).
- **Card button:** a bigger circle level with the other tabs (not raised), no label, the real Futty logo (the F with the football) inside. The variants (decided 22 November):

  | Plan | Light mode | Dark mode |
  | --- | --- | --- |
  | Basic | Mint circle, dark logo, white bar | Mint circle, dark logo, dark bar |
  | Premium | Black circle, neon mint logo, white bar | Black circle with a thin mint ring, neon mint logo, dark bar |

  Premium comes from the server. It opens the player card (image 20).
- **Selected tab:** a soft green pill, with dark text in light mode and mint in dark mode.
- **Rankings** holds Team of the Week and Power ranking (images 14, 15).
- **Header (fixed):** the Futty wordmark on Home and the tab name elsewhere, a bell (notifications, with a dot), and a menu button that opens **Account**: My bookings, Payments, Messages, Saved searches, Premium, Settings, Help, and Venue dashboard for venue staff only.
- **Futty AI:** no floating button. It moves to Account → Help, plus a small "?" icon in the header of Book, the venue page and the payment sheet.

### 0.6 Key screens (replaces section 5 where they overlap)

| Screen | Layout (agreed image) |
| --- | --- |
| Home (01, 26) | In this order: greeting → four quick actions **Book a pitch · Find a match · Leagues · Join an event** → **Log the score** (only when one is pending) → **Upcoming matches** → **Games needing players** → **Featured event** → a rotating banner (Team of the Week → Profile → Leagues → Go Premium, every 5 seconds; it stops with Reduce motion) → **Futty Games**. **No weather card on Home.** |
| Book a pitch (02) | Search with a location field, View map, and filter chips (Filters, format, day, time of day). Venue cards: photo, name, area, "from [PRICE] per player", amenities, free times as chips. |
| Venue page (03) | Swipeable photos, then name, area and amenities, **Directions · Website · Call**, then three tabs **Home \| Book \| Facilities**. It opens on Book when coming from Book a pitch. **Home:** info, Directions · Website · Call, map, weather, hours, offers, top players, recent results. **Book:** format, day, time, pitch (preselected), weather at that time, and a sticky bar with the choice and **Continue**. **Facilities:** amenities and the food and drink menu. |
| Payment sheet (04) | A bottom sheet with a drag handle: pitch choice, who pays, the price lines, way to pay, the cancellation line with a **Rules** link, and **Pay**. Every amount and time comes from the server (13). |
| Find a match (05) | Search, a filter chip (format \| town \| period), **Find me an opponent** and **Browse teams**, then games by day. |
| After the game (07–11) | Score → Goals → Assists → Review, with a progress bar. The opposition's side is locked when its own captain logs it. |
| Leagues (12), league and tournament pages (13, 16, 17) | SofaScore style: Matches \| Leagues, pinned leagues, then by area with format rows. A competition page has a dark header and tabs (Overview, Matches, Standings, Player stats, Knockout). "Coming soon" pages show one line and one button. |
| Rankings (14, 15, 27) | Team of the Week \| Power ranking, a format picker (5, 6, 7, 9, 11). Team of the Week: the week, scope and area pickers, the team on a pitch, player of the week. Rules: `match-record.md` decision 1k. |
| Community (18) | Dark header with Search, tabs **For you · Following · Find players**, post cards, and a "+" button. |
| Profile (19) | Dark top with level, **My card** and **Edit profile**, then This season, Recent games, My teams, Dream team. |
| Player card (20) | A sheet: avatar, name, level, details, QR, **Share · Scan · Edit**. |
| Futty Games (21), Premium plans (22) | As in the images. |
| Venue dashboard (23–25) | Today, the booking roster sheet and Money, as in the images, with every rule from 13. |

Booking detail, debt and credit keep their section 5 rows, in the new look.

### 0.7 Words and UX rules (every screen)

- **Labels only:** headings of 1–3 words; buttons of 1–3 words that start with a verb. No explanations, tips, intros or paragraphs.
- **Text is allowed in three places only**, one line of at most 10 words each:
  1. under each way to pay;
  2. the cancellation line on the payment sheet, with a "Rules" link;
  3. errors and blocks: what happened, plus what to do.
- Everything else moves to Terms or Help (`app/account/help.tsx`, `terms.tsx`). The site test (site matches app) keeps passing.
- **Money and rules lines stay true to 13**; times and amounts come from the server. Each pull request lists every such line it shows.
- **Booking path from Home:** Book a pitch → tap a time → pick a pitch (preselected) → Continue → Pay. No extra screens.
- **Tappable everywhere:** every player name or avatar opens their profile, and every team name or badge opens the team page.
- One main action per screen. Never show the same fact twice. Hide empty sections. An empty state is one line and one button.
- **Every list:** skeletons while loading, pull to refresh, a one-line error with "Try again", and long lists virtualised (FlatList or SectionList).
- **Touch and access:** touch targets of at least 44 pt, an accessibility label on every button and icon, works with large text and VoiceOver, correct from iPhone SE to Pro Max and on Android.
- **Haptics:** a light haptic on key actions (book, pay, send, add friend) with `expo-haptics`, unless the player switched haptics off.
- **Smooth:** native-feel transitions, bottom sheets with drag handles, no layout jumps when data arrives.

### 0.8 Engineering rules for the redesign

- Every existing data hook, server call and rule stays unless a step says otherwise. No feature becomes unreachable; anything without a place goes in the Account menu.
- No change to payment, Stripe, prices or money code. Every existing money test passes.
- Shared files (`constants/`, `components/ui/`, `app/(tabs)/_layout.tsx`, `app.json`, `package.json`) change only in S1, S2 and S16.
- Never remove or rename an existing testID: move it to the new element that does the same job. Every new button, input, tab and list row gets a kebab-case testID (`screen-element`), and the `.maestro` flows are updated with each step.
- Age and safety rules: 05 section 16. Team of the Week rules: `match-record.md` decision 1k.

### 0.9 Where every existing screen goes

| Screen today | New place | Step (owner) |
| --- | --- | --- |
| `app/(tabs)/index.tsx` Home | Home tab (01, 26) | S3 (Anghelo) |
| `app/(tabs)/book.tsx` Book tab, `app/book.tsx` | No longer a tab: Home → **Book a pitch** (02) | S2, S4 (Dimitris) |
| `app/(tabs)/play.tsx` Play tab | No longer a tab. Its segments move: Teams → Profile → My teams; Matches → Home → **Find a match**; Leagues → Home → **Leagues**; Community → Community tab | S2, then S6–S9 |
| `app/(tabs)/community.tsx` | Community tab (18) | S7 (Anghelo) |
| `app/(tabs)/leagues.tsx` | Home → Leagues (12); league and tournament pages (13, 16, 17) | S9, S10 (Anghelo) |
| `app/(tabs)/team.tsx` | Profile → My teams | S8 (Anghelo) |
| `app/(tabs)/profile.tsx` | Profile tab (19) | S8 (Anghelo) |
| `app/account/index.tsx` | Header menu → Account | S2 (Dimitris) |
| `app/account/activity/*` | Profile → Recent games → All games, and Profile → My teams; Account until S8 places them | S8 |
| `app/account/help.tsx`, `how-it-works.tsx` | Account → Help (with Futty AI) | S2 |
| `app/account/terms.tsx`, `privacy-policy.tsx` | Account → Help | S2 |
| `app/account/payments/*` | Account → Payments | S2 |
| `app/account/premium.tsx`, `app/premium-plan.tsx` | Account → Premium (22) | S2, P1 (Panos) |
| `app/account/saved-searches.tsx`, `app/saved-search.tsx` | Account → Saved searches | S2 |
| `app/account/settings/*` | Account → Settings, plus Appearance and Accessibility | S1, S2 (Dimitris) |
| `app/my-bookings.tsx` | Account → My bookings | S2 |
| `app/booking/[id].tsx` | Home → Upcoming matches card, and My bookings | unchanged |
| `app/booking-payment.tsx` | The payment sheet (04) | B2 restyle (Panos) |
| `app/booking-after-pay.tsx`, `app/losers-pay-leave.tsx` | Unchanged, from the payment sheet and booking detail | — |
| `app/venue/[id].tsx` | Venue page, Home \| Book \| Facilities (03) | S5, S5A (Panos) |
| `app/squads.tsx`, `app/join-squad-post.tsx` | Home → Games needing players; Find a match; Community posts (**Join squad**) | S6, S7 |
| `app/matchmaking.tsx` | Find a match → **Find me an opponent** (05) | S6 (Dimitris) |
| `app/opposition-invite.tsx` | "You've been matched" (06) | S20C (Anghelo) |
| `app/match/after-game.tsx` | Home → **Log the score** (07–11) | S13B (Anghelo) |
| `app/match/[id].tsx` | Any result row or card | unchanged |
| `app/match/team-of-the-week.tsx` | Rankings → Team of the Week (15, 27) | S14, S15 (Anghelo) |
| `app/match/leaderboards.tsx` | No place agreed yet: Account menu until S15 decides | S15 |
| `app/upcoming-fixtures.tsx`, `app/previous-games.tsx` | Home → Upcoming matches; Profile → Recent games → All games; a competition's Matches tab | S3, S8, S10 |
| `app/fixture-chat.tsx`, `app/fixture-confirmed.tsx` | The fixture, and Account → Messages | S10, S11 |
| `app/team-profile.tsx`, `app/player-profile.tsx` | Any team name or badge; any player name or avatar | S8 |
| `app/notifications.tsx` | Header bell | S2 |
| `app/edit-profile.tsx`, `app/edit-avatar.tsx` | Profile → Edit profile; player card → Edit | S8, S19 |
| `app/check-in.tsx` | Deep link from the venue QR; player card → Scan | S19 |
| `app/venue-dashboard.tsx` and `app/venue-*.tsx` (bookings, closures, credits, customers, customer, debts, hours, menu, money, payouts, photos, pitches, prices, amenities) | Account → Venue dashboard, staff only (23–25) | P6 restyle (Dimitris) |
| `app/sign-in.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `confirm-email.tsx`, `choose-username.tsx`, `starting-level.tsx`, `auth/callback.tsx` | Unchanged; sign-up adds date of birth (05 section 16, A1) | S12 |
| `app/modal.tsx` | Expo template screen, not linked from anywhere | — |
| `app/dev/components.tsx` | Development only | — |
| New | Card button → player card (20); Rankings tab (14, 15); Futty Games (21); Account → Messages; Home → Join an event | S2, S15, S19, G1–G5 |

### 0.10 Open questions (not decided in S0)

1. **Banner ads.** Images 01, 14, 15, 18 and 19 show "Banner ad · Basic and Premium only", and image 22 shows a Premium Plus plan with no ads. No spec has a rule on ads or Premium Plus, so S0 records neither. P1 or its owner decides.
2. **Team of the Week:** see `match-record.md` decision 1k, open points.

## 1. What Playtomic gets right (and what it doesn't)

What its app and site show:

- **Club cards are photo-first:** a photo, the club name, its address and one "Book now" action. The whole card opens the club.
- **Booking is a date picker plus a grid of time slots.** Reviewers sum the flow up as "find a club, see live availability, pay, done".
- **Home shows what needs your attention**, for example every pending match payment.
- **Navigation is built around playing:** booking, matches, progress (level and stats), community.
- **Players appear as small avatar previews.** Matches are cards that change as the match moves through its stages.

Where it falls short, and where Futty can beat it:

- **Finding a game means digging club by club.**
- **Cancellation terms aren't shown before paying.**
- **There's no add-to-calendar or directions.**
- **Its support has a bad reputation.**

Futty shows the price per player, the cancellation rule and who's in on every booking screen, and shows "Add to calendar" and "Directions" on every booking.

## 2. Why Futty looks childish today

From the code (`constants/futty-theme.ts` and the screens):

- **Too many colours.** A bright green ramp (#15803d to #4ade80) plus sky, coral and violet accents used for variety.
- **A novelty display font.** Archivo Black is used for headings.
- **Oversized rounding.** Corners of 20 to 30 points on cards and buttons.
- **Illustrations instead of photos.** A drawn pitch background and multicoloured category icons.

## 3. The rules

### Colour

**Replaced by section 0.2** (the token table and `brand` #0E5A3A below no longer apply; the rules on contrast, gradients and status colours still do).

Every colour below is a token in `constants/futty-theme.ts`. Screens never hard-code a colour.

| Token | Value | Used for |
| --- | --- | --- |
| `ink` | #0B1215 | Headings and body text |
| `inkMuted` | #5B6470 | Secondary text, captions |
| `surface` | #FFFFFF | Cards, sheets, inputs |
| `canvas` | #F4F5F7 | Screen background behind cards |
| `border` | #E4E7EB | Hairlines, card borders, dividers |
| `brand` | #0E5A3A | Primary buttons, selected states, links. Nothing else |
| `brandSoft` | #E7F1EC | Selected chip and row backgrounds |
| `success` | #1F7A45 | Paid, confirmed |
| `warning` | #8A5C00 | Pending, weather warnings, short game |
| `danger` | #B42318 | Debt, failed payment, destructive actions |

- **The brand colour is used only for primary actions, selected states and links.** Never for decoration, headings or icons.
- **No gradients, no coloured backgrounds behind sections, no extra accent colours.**
- **Status colours appear only as small pills, icons or text.** They're never large fills.
- **Everything passes WCAG AA contrast:** 4.5:1 for text, 3:1 for icons and borders that carry meaning.

### Type

- ~~**One family: Inter.**~~ **Replaced by section 0.3:** Cairo for headings and numbers, Inter for the rest. Archivo Black is removed. IBM Plex Mono is kept only for codes, like a check-in code.
- **Scale** (size/line height, weight):

| Style | Size / line height | Weight |
| --- | --- | --- |
| `display` | 28/34 | 700 |
| `title` | 22/28 | 700 |
| `headline` | 17/22 | 600 |
| `body` | 15/20 | 400 |
| `callout` | 13/18 | 500 |
| `caption` | 12/16 | 500 |

- **Prices, times and scores use tabular figures** (`fontVariant: ['tabular-nums']`) so columns line up.
- **Sentence case everywhere.** No all-caps headings and no exclamation marks.

### Space, shape, depth

- **4-point grid.** 16 side gutter, 12 between cards, 24 between sections.
- **Radius:** 12 for cards and images, 10 for buttons and inputs, fully round for chips and avatars.
- **Depth:** a hairline border (`border`) or one soft shadow (y 2, blur 8, 6% black), never both. No heavy shadows.
- **Touch targets of at least 44 × 44.**

### Icons and imagery

- **Icons:** SF Symbols on iOS through `expo-symbols`, with the matching Material icons on Android (`components/ui/icon-symbol`). Monochrome, 20 or 24 points. **No emoji anywhere in the UI.**
- **Photos:** real venue photos supplied by the venue. 16:9 on cards, 4:3 in galleries, radius 12. When there's no photo, show a neutral `canvas` block with the venue's initials. No illustrations or stock art.

### Motion and feedback

- **Animation only to explain change:** sheets sliding up, a row being removed. 200–250 ms, standard easing. Respect "Reduce motion".
- **Haptics:** a light tap on primary actions; success or error feedback after paying.
- **Loading:** skeleton blocks in the shape of the content, never a full-screen spinner. **Errors** appear inline with a retry button.

### Words

- **Money is always explicit:** "€6.80 (pitch €6.00 + service fee €0.80)". Amounts have a € sign and 2 decimals.
- **Every money screen says who pays what and when.**
- **Never say "authorize", "capture" or "void".** Say "held", "charged" and "released".
- **Buttons say what happens:** "Pay €6.80", "Cancel my spot", "Pay what I owe". Not "Submit" or "OK".

## 4. Navigation

**Replaced by section 0.5.** The 7 November plan below is kept for history only.

- **Four tabs:** **Home**, **Book**, **Play** (teams, matches, leagues, community) and **Profile**.
- **Notifications** sit behind a bell in the Home header.
- **Large titles** on iOS. Pushed screens use the standard back button.
- **The venue dashboard stays separate**, reached from Profile for venue staff only.

## 5. Key screens

**Home, Book and the venue page are replaced by section 0.6** (Home has no weather chip; the venue page has three tabs and a Continue bar). Checkout follows the payment sheet (image 04) with the rules from 13. Booking detail, debt and credit, and the venue dashboard rows still apply.

| Screen | What it must show |
| --- | --- |
| Home | Next game card: venue photo, time, who's in (avatar stack), who hasn't paid, a weather chip. A banner for anything owed (debt, failed payment). Quick actions (Book, Find a game). Venues nearby. "Need players" games. |
| Book | A date strip (7 or 14 days by account type), a time picker and the format (plus "players per side" where the venue allows 6 v 6). Then the venues free at that time as photo cards: name, area, price per player, the next free times as chips. |
| Venue page | Photo gallery, name, address with Directions, amenities as an icon row, pitches, prices, cancellation rules, a weather strip, offers. A sticky bottom bar with "Book". |
| Checkout | A segmented control for **Pay for everyone / Each pays**, then **I'm responsible for the team / Just my spot**. Price breakdown lines. The cancellation rules in 3 lines. The non-refundable notice when kickoff is under 6 hours away. Apple Pay / Google Pay button. A sticky bottom bar with the total. |
| Booking detail | Status pill, roster with each player's paid state (in app, cash, unpaid), invite and share, cancellation countdown, Add to calendar, Directions, weather. A cancel button that first shows exactly what happens to the money (from the server). |
| Debt and credit | The amount owed and to which venue, with "Pay what I owe". Credit per venue with its expiry date. |
| Venue dashboard | A day calendar per pitch. Tap a booking to see its roster and tick cash as paid. Block pitches, flag conditions, settle debt, run collection. Every common action in two taps or fewer. |

## 6. Components (`components/ui/`)

These are built once, with tests, and used everywhere:

- **Buttons and forms:**
    - `Button` (primary, secondary, destructive, plain; loading and disabled states);
    - `IconButton`;
    - `TextField`.
- **Lists and controls:**
    - `ListRow` (title, subtitle, accessory, chevron);
    - `SegmentedControl`;
    - `Chip` (selectable).
- **Cards and display:**
    - `Card`;
    - `VenueCard`;
    - `StatusPill`;
    - `AvatarStack`;
    - `PriceBreakdown`.
- **Feedback and layout:**
    - `StickyActionBar` (total + primary button);
    - `Banner` (info, warning, danger);
    - `EmptyState`;
    - `Skeleton`;
    - `Sheet`;
    - `SectionHeader`.

Each component:

- takes tokens, never raw colours;
- has an accessibility label;
- supports Dynamic Type up to XL without clipping;
- has a Jest test for its states.

## 7. Reference pack

**Replaced by section 0.1** (the "Futty App Screens" and "futty-design-refs" folders).

**Take 12 screenshots of the Playtomic app and put them in a Drive folder called "Design references":**

- Home
- Search results
- A club page
- The slot picker
- Checkout
- A match card
- Profile
- Level and stats
- Notifications
- A booking detail
- The cancel flow
- Settings

Attach the ones that matter to the Claude Code session when restyling a screen. They're for internal reference only. Nothing from them goes into the app.

## Sources

- [Playtomic.com: club cards and the "Find, Book, Join" structure](https://playtomic.com/)
- [Playtomic app listing summary: screens and features](https://mwm.ai/apps/playtomic-padel-pickleball/1242321076)
- [Playtomic 6.51 release notes: pending payments on Home](https://www.apkmirror.com/apk/playtomic-s-l/playtomic-padel-pickleball/playtomic-padel-pickleball-6-51-0-release)
- [Playtomic App Design on Behance: feed, cards, story-style players](https://www.behance.net/gallery/154827807/Playtomic-App-Design)
- [Rivals review: "find a club, see live availability, pay, done"](https://getrivals.app/articles/padel-apps/apps-playtomic-review)
- [Critique: digging club by club; no terms before paying; no calendar or directions](https://guzhikov.substack.com/p/playtomic-has-the-liquidity-but-missing)

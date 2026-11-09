# 15 Futty – Design Brief

7 November 2026 · Owner: Panos (all UI work) · The Claude Code prompts that build this are in 17 UI Redesign Prompts

**Futty should look like a calm, professional booking tool: lots of white space, one brand colour, real photos, clear prices, no decoration.** Playtomic is the reference for structure and tone. We borrow how its screens are organised, never its logo, colours, illustrations or wording.

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

- **One family: Inter.** Remove Archivo Black from the UI. IBM Plex Mono is kept only for codes, like a check-in code.
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

- **Four tabs:** **Home**, **Book**, **Play** (teams, matches, leagues, community) and **Profile**.
- **Notifications** sit behind a bell in the Home header.
- **Large titles** on iOS. Pushed screens use the standard back button.
- **The venue dashboard stays separate**, reached from Profile for venue staff only.

## 5. Key screens

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

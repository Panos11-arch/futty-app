# U4 Play section – plan

Prompt: docs/specs/17-ui-prompts.md, U4. Look: docs/specs/15-design.md. Restyle only: same data, same server calls with the same arguments, same navigation targets.

## Files

| File | Owner (CLAUDE.md) | What changes |
| --- | --- | --- |
| app/(tabs)/team.tsx | Anghelo | Team card (Card, Avatar, stat tiles in tabular figures), roster as ListRows in a Card, Team Premium rows as ListRows, Button instead of AuthButton, skeleton, EmptyState, Banner errors |
| app/(tabs)/leagues.tsx | Anghelo | League tables: aligned tabular columns, header in caption, the user's team rows on brandSoft; sections with SectionHeader; Matchmaking as a ListRow; Button/TextField; skeletons; Banner errors with retry where a reload exists |
| app/(tabs)/community.tsx | Anghelo | Contacts and teams as ListRows with avatar, name, one row of actions (Follow, Invite, Block/report as an IconButton); no coloured icons; Contacts / Teams as two plain Chips (a SegmentedControl there would add tab roles inside Play's own segmented control) |
| app/upcoming-fixtures.tsx | Anghelo | Each fixture a Card, times tabular, actions as Buttons, EmptyState, skeleton, Banner error with retry |
| app/previous-games.tsx | Anghelo | Cards, EmptyState, skeleton, Banner errors (retry already exists for match links) |
| app/fixture-confirmed.tsx | Anghelo | No pitch background, no dark mode; Button "View booking"; title in sentence case |
| app/fixture-chat.tsx | Anghelo | Standard bubbles: surface (others) / brandSoft (mine), timestamps caption; header with IconButton for report |
| app/matchmaking.tsx | Anghelo | Fixtures as ListRows in Cards; intro text; EmptyState; wizard body in tokens (WizardModal itself is U7) |
| app/team-profile.tsx | Anghelo | Already on components/ui: canvas background added |
| app/player-profile.tsx | Anghelo | Already on components/ui: canvas background added |
| components/fixture-confirmed-card.tsx | Anghelo (match) | Tokens; no emoji, no amber/coral; "vs" text |
| components/fixture-score-form.tsx | Anghelo (match) | Tokens; score inputs tabular; Button |
| components/booking-result-form.tsx | Panos (booking) | Tokens; Button |
| components/add-player-row.tsx | shared | TextField with label, Button |
| components/chip.tsx | shared | Same props, restyled to the components/ui Chip look (brandSoft selected, 44 pt tall) |
| components/pitch-background.tsx | — | Deleted (only fixture-confirmed used it) |

Not touched: components/ui, constants/, _layout files, package.json, app.json, popup-modal.tsx and wizard-modal.tsx (U7), auth-form.tsx (U6), lib/.

## Copy (spec 15 "Words")

Only where 15 forbids the current text: "Match Found" -> "Match found", "Pitch booked!" -> "Pitch booked", "VS" -> "vs", "Submit" / "Submit report" -> "Send report", all-caps table headers -> caption case. Every other string stays.

## Behaviour kept

Every onPress keeps its target and arguments; every hook and server call is unchanged; disabled/busy rules are the same (AuthButton busy -> Button loading). Retry buttons call a reload the screen already has; where none exists the error stays without one and is listed as TO DECIDE.

## Tests

- tests/play/*.test.tsx: each screen renders loading, empty and populated states (snapshots), buttons call the same functions with the same arguments, navigation targets unchanged.
- League table: the user's team rows have the brandSoft background, others don't.
- tests/play/tokens-only.test.ts: no hex colours, rgb(), numeric fontSize or emoji in any U4 file.
- Existing tests (tests/navigation/play.test.tsx, tests/profile/*, components/match/fixture-score-entry.test.tsx, tests/home) still pass.

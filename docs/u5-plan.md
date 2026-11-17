# U5 Profile, account and Premium – plan

Prompt: docs/specs/17-ui-prompts.md, U5. Look: docs/specs/15-design.md. Restyle only: same data, same server, App Store and Stripe calls with the same arguments, same navigation.

## Files

| File | Owner (CLAUDE.md) | What changes |
| --- | --- | --- |
| app/(tabs)/profile.tsx | Anghelo | Avatar, name, a neutral level badge, stats as three small tiles in tabular figures, XP line; the existing rows (Premium, Venue dashboard, Account & settings, Sign out) as grouped rows. Skeleton, Banner error with retry (profile.reload). `ProfileCard` keeps its props (player-profile uses it) |
| components/menu-row.tsx | shared | MenuRow / MenuSection keep their props: grouped iOS-style list, SectionHeader titles, inset hairlines, monochrome icons, danger only for destructive rows |
| components/doc-screen.tsx | shared | Doc screens on canvas, type scale, FAQ cards; e-mail link is a plain Button |
| app/account/index.tsx, payments/index.tsx, settings/index.tsx | Panos | Through MenuRow / MenuSection; canvas; labels in sentence case |
| app/account/activity/index.tsx, matches.tsx, teams.tsx | Panos | Results and teams as rows in a Card (tabular scores), skeleton, EmptyState, Banner with retry |
| app/account/payments/methods.tsx | Panos | Card with the default card and one Button; skeleton |
| app/account/payments/transactions.tsx | Panos | Rows with the server's amount right-aligned in tabular figures and a StatusPill (paid, pending, refunded); `formatEuros` instead of `(cents / 100).toFixed(2)` (same text, no floating point) |
| app/account/settings/privacy.tsx, security.tsx | Panos | ListRow + Switch in a Card, like settings/notifications.tsx |
| app/account/premium.tsx | Panos | Plans as ListRows with Active / Off |
| app/account/terms.tsx, help.tsx | Panos | Skeleton and Banner retry on terms; spacing token on help |
| app/premium-plan.tsx | Panos | One Card: plan, the price (the App Store's live price for Personal, from the rules until the store answers), the perks, one primary Button. No dark backdrop, crown badge or "FUTTY PREMIUM" caps |
| app/notifications.tsx | Anghelo | Rows with an unread dot, grouped Today / Earlier by the Cyprus calendar day; Accept / Decline as Buttons beside the row instead of nested inside it |
| app/edit-profile.tsx | Panos | Tokens, components/ui Chip and Button, skeleton |
| components/futty-ai-chat.tsx | Panos | Same bubbles as U4's chat (surface / brandSoft); launcher on brand with the one shadow token |

Not touched: components/ui, constants/, _layout files (screen titles there stay as they are), package.json, app.json, lib/, server code. app/account/how-it-works.tsx, privacy-policy.tsx, payments/owed.tsx and settings/notifications.tsx change only through the shared components.

## Copy (spec 15)

Sentence case on menu rows and section titles ("Edit profile", "Your payments", "Log out", "Terms of use", "Legal information"…). "Futty", "Premium" and "Team Premium" are names and keep their capitals.

## TO DECIDE

- Profile: the prompt lists My bookings, Payments, Settings and Help rows on Profile. Profile today links to Account & settings (where all four live); adding the rows adds navigation, so it is left as it is.
- Premium: the prompt asks for "the two benefits"; the perks come from the rules (personalPremiumPerks) and include a third, "Verified badge on your profile".
- Team Premium prices (€45 / €59 per season) are client constants (lib/teams.ts), not from the store.
- Screen header titles in app/_layout.tsx are Title Case (shared file).
- Payment methods and transactions have no retry on error (they load once in an effect).

## Tests

tests/account/*: snapshot per state; Premium shows the price passed in from the store (not a hard-coded €4.99 or €3.99); transactions show the server's amounts unchanged; notifications group by Cyprus day whatever the phone's zone; the same calls with the same arguments (purchase, restore, invites, privacy toggle, AI chat); a tokens-only scan of every U5 file.

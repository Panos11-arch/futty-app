# U7 Squads, posts and pop-ups – plan

Prompt: docs/specs/17-ui-prompts.md, U7. Look: docs/specs/15-design.md. Restyle only: same data, same server and Stripe calls with the same arguments, same navigation.

## Files

| File | Owner (CLAUDE.md) | What changes |
| --- | --- | --- |
| app/squads.tsx | Panos | Posts as Cards: venue, day and time (tabular), format, level, spots left, one action. No tinted info boxes or coloured tags. SegmentedControl for Need players / Need opposition. Skeleton, EmptyState, Banner error with retry (posts.reload) |
| app/join-squad-post.tsx | Panos | Card with the post; the server's share (squad_post_price) shown with PriceBreakdown, unchanged; the venue's block notice as a warning Banner; one full-width primary Button with loading; skeleton; Banner error with retry |
| app/modal.tsx | shared (Expo template) | Tokens only |
| components/popup-modal.tsx | shared | Tokens, IconButtons (44 pt) for back and close, headline title. Same props, still a full-screen modal (see TO DECIDE) |
| components/wizard-modal.tsx | shared | Progress as "Step 2 of 3 · Time" text, no coloured bar; Continue is the components/ui Button (loading); back is an IconButton; the slide respects Reduce motion |
| components/parallax-scroll-view.tsx | shared | Deleted: nothing uses it (the plain large title is already the norm) |
| components/icon-label.tsx | shared | Default icon colour inkMuted (not brand), 20 pt default |
| components/external-link.tsx | shared | No styling of its own; unchanged |

Not touched: components/ui, constants/, _layout files, package.json, app.json, lib/, server code.

## Copy (spec 15)

Sentence case on buttons: "Join & Pay My Share" -> "Join and pay my share", "Offer & Pay My Share" -> "Offer and pay my share". "Please wait…" goes; the Button's spinner shows instead. Everything else stays.

## TO DECIDE

- The squads list has no price per player: showing one needs squad_post_price per card (a new server call per post). Join-squad-post already shows it from the server.
- Pop-ups as bottom Sheets: PopupModal hosts full-screen content (Futty AI chat, the country list, Match found) with a footer slot and a back button; components/ui Sheet has neither, so switching needs a Sheet change first (separate components/ui PR).
- Times on squad posts use the phone's time zone (toLocaleString), not Asia/Nicosia.

## Tests

tests/squads/*: snapshot per state (loading, empty, error, populated) for squads and join-squad-post; join-squad-post shows the server's price unchanged; the same calls with the same arguments (join, leave, offer, cancel, navigation); WizardModal shows "Step 2 of 3" text and no progress bar, and its Continue is disabled/busy as before; PopupModal back and close fire their handlers; tokens-only scan of these files. "A Sheet closes on the secondary Button and on swipe down" is already proven in components/ui/sheet.test.tsx; no pop-up becomes a Sheet in this PR (see TO DECIDE), so nothing new to test there.

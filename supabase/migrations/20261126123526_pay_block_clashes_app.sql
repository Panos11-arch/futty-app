-- Clashes when blocking, the app part (doc 28 prompt 1; docs/specs/13-payments-bookings.md
-- "Blocking pitches": "Blocks are created only through venue_add_block. The
-- app's direct insert is withdrawn once the clash sheet ships").
--
-- The app now saves a block only through venue_add_block (after
-- venue_block_clashes), so signed-in users lose insert and update on
-- venue_blocks. Delete stays: Remove block (decided 14 November) is still the
-- owner's own row, through the "Venue owners manage their blocks" policy.
-- venue_add_block is security definer and inserts as its owner, so it isn't
-- affected. Signed-out users never had a policy on it; their default grants
-- go too. Nothing else changes.

revoke insert, update on public.venue_blocks from authenticated;
revoke insert, update, delete on public.venue_blocks from anon;

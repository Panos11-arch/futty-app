// Notifies both rosters once a "need opposition" post is matched AND the
// offering captain's own payment share has actually been authorized —
// invoked directly by the client (app/squads.tsx's OppositionPostCard),
// fire-and-forget, right after presentPaymentSheet() succeeds. Deliberately
// NOT fired at match time (offer_opposition, supabase/opposition-match-
// payments.sql) — if the offering captain's own first payment fails or is
// cancelled, the match is rolled back (cancel_opposition_offer) and nobody
// should have been told "you're playing" for a game that then un-happened.
//
// Writes both the in-app bell row (notifications table, type
// 'match_payment_due') and a real Expo push, same split responsibility as
// supabase/functions/notify-squad-post-created.
//
// Deploy with:
//   npx supabase functions deploy notify-opposition-matched

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type SquadPost = {
  id: string;
  team_id: string | null;
  matched_team_id: string | null;
  venue_id: string;
  format: string;
  scheduled_at: string;
  venue_booking_id: string | null;
};

function formatWhen(iso: string) {
  const date = new Date(iso);
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Nicosia' });
  const time = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Nicosia',
  });
  return `${weekday} ${time}`;
}

Deno.serve(async (req) => {
  const { postId, payerProfileId } = await req.json().catch(() => ({}));
  if (typeof postId !== 'string') {
    return new Response(JSON.stringify({ error: 'missing postId' }), { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: post } = await supabase
    .from('squad_posts')
    .select('id, team_id, matched_team_id, venue_id, format, scheduled_at, venue_booking_id')
    .eq('id', postId)
    .maybeSingle<SquadPost>();
  if (!post || !post.team_id || !post.matched_team_id) {
    return new Response(JSON.stringify({ error: 'post not found or not matched' }), { status: 404 });
  }

  const [{ data: venue }, { data: teamA }, { data: teamB }, { data: booking }] = await Promise.all([
    supabase.from('venues').select('name').eq('id', post.venue_id).maybeSingle(),
    supabase.from('teams').select('id, name').eq('id', post.team_id).maybeSingle(),
    supabase.from('teams').select('id, name').eq('id', post.matched_team_id).maybeSingle(),
    post.venue_booking_id
      ? supabase.from('venue_bookings').select('amount_cents').eq('id', post.venue_booking_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const venueName = venue?.name ?? 'a venue';
  const when = formatWhen(post.scheduled_at);
  const needsPayment = !!booking && (booking.amount_cents ?? 0) > 0;

  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('profile_id, team_id')
    .in('team_id', [post.team_id, post.matched_team_id])
    .in('role', ['captain', 'player']);

  const recipients = (rosterRows ?? []).filter((row) => row.profile_id !== payerProfileId);
  if (recipients.length === 0) {
    return new Response('no recipients', { status: 200 });
  }

  const bodyFor = (theirTeamId: string) => {
    const mine = theirTeamId === post.team_id ? teamA : teamB;
    const opponent = theirTeamId === post.team_id ? teamB : teamA;
    const opponentName = opponent?.name ?? 'the other team';
    return needsPayment
      ? `${mine?.name ?? 'Your team'} vs ${opponentName} — ${post.format} at ${venueName}, ${when}. Pay your share to lock in the match.`
      : `${mine?.name ?? 'Your team'} vs ${opponentName} — ${post.format} at ${venueName}, ${when}. It's on!`;
  };

  const notificationRows = recipients.map((row) => ({
    profile_id: row.profile_id,
    type: 'match_payment_due',
    title: needsPayment ? 'Your team is playing — pay your share' : 'Your team is playing!',
    body: bodyFor(row.team_id),
    data: { postId: post.id, bookingId: post.venue_booking_id },
  }));
  await supabase.from('notifications').insert(notificationRows);

  const recipientIds = recipients.map((row) => row.profile_id);
  const { data: tokenRows } = await supabase.from('push_tokens').select('profile_id, token').in('profile_id', recipientIds);
  if (!tokenRows || tokenRows.length === 0) {
    return new Response('notified in-app only, no push tokens', { status: 200 });
  }

  const rosterTeamById = new Map(recipients.map((row) => [row.profile_id, row.team_id]));
  const messages = tokenRows.map((row) => ({
    to: row.token as string,
    sound: 'default',
    title: needsPayment ? 'Your team is playing — pay your share' : 'Your team is playing!',
    body: bodyFor(rosterTeamById.get(row.profile_id as string) ?? post.team_id),
    data: { postId: post.id, bookingId: post.venue_booking_id },
  }));

  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  return new Response('sent', { status: 200 });
});

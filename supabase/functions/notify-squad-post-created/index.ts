// Sends a real Expo push notification to every profile
// public.squad_post_notification_recipients() matches for a newly created
// squad post (same city as the venue, on a team whose roster_size matches
// the post's format) — item 5 of the payment-auth batch. The in-app bell
// row for the same event is written separately by the on_squad_post_
// created_notify trigger (supabase/squad-post-notifications.sql); this
// function only adds the push leg, since this project has no pg_net/Database
// Webhook support for a trigger to call out to Expo's push API itself.
//
// Invoked directly by the client right after create_squad_post succeeds
// (see lib/squads.ts) — fire-and-forget, matching how create-share-payment
// etc. are called. Deploy with:
//   npx supabase functions deploy notify-squad-post-created

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type SquadPost = {
  id: string;
  type: 'players' | 'opposition';
  format: string;
  venue_id: string;
  posted_by: string | null;
  team_id: string | null;
};

Deno.serve(async (req) => {
  const { postId } = await req.json().catch(() => ({}));
  if (typeof postId !== 'string') {
    return new Response(JSON.stringify({ error: 'missing postId' }), { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: post } = await supabase
    .from('squad_posts')
    .select('id, type, format, venue_id, posted_by, team_id')
    .eq('id', postId)
    .maybeSingle<SquadPost>();
  if (!post) {
    return new Response(JSON.stringify({ error: 'post not found' }), { status: 404 });
  }

  const { data: recipients } = await supabase.rpc('squad_post_notification_recipients', { p_post_id: postId });
  const profileIds = (recipients ?? []).map((row: { profile_id: string }) => row.profile_id);
  if (profileIds.length === 0) {
    return new Response('no recipients', { status: 200 });
  }

  const { data: tokenRows } = await supabase.from('push_tokens').select('token').in('profile_id', profileIds);
  if (!tokenRows || tokenRows.length === 0) {
    return new Response('no tokens', { status: 200 });
  }

  const { data: venue } = await supabase.from('venues').select('name').eq('id', post.venue_id).maybeSingle();
  const venueName = venue?.name ?? 'a venue';

  let title: string;
  let body: string;
  if (post.type === 'players') {
    const { data: poster } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', post.posted_by ?? '')
      .maybeSingle();
    title = 'Looking for players';
    body = `${poster?.username ?? 'Someone'} needs players for ${post.format} at ${venueName}`;
  } else {
    const { data: team } = await supabase.from('teams').select('name').eq('id', post.team_id ?? '').maybeSingle();
    title = 'Looking for opposition';
    body = `${team?.name ?? 'A team'} wants a ${post.format} match at ${venueName}`;
  }

  const messages = tokenRows.map((row) => ({
    to: row.token as string,
    sound: 'default',
    title,
    body,
    data: { postId: post.id, postType: post.type },
  }));

  // Expo's push API accepts at most 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  return new Response('sent', { status: 200 });
});

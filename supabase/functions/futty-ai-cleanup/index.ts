// Scheduled job (pg_cron + pg_net, once a day): deletes Futty AI chats and
// their photos 7 days after the chat's last message (S13A, decided 22
// November; public.ai_chat_keep_days). The logic is in
// _shared/ai-chats.ts. Authenticated by the cron secret, like
// run-payment-jobs.
//
// Also (S7b): removes post photos uploaded but never posted, 24 hours on
// (public.post_photos_pending_expired, _shared/post-photos.ts). A failure
// there is logged and doesn't stop the chats' cleanup.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { deleteExpiredAiChats } from '../_shared/ai-chats.ts';
import { deleteExpiredPendingPhotos } from '../_shared/post-photos.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);
  try {
    const result = await deleteExpiredAiChats({
      async expired(limit) {
        const { data, error } = await admin.rpc('ai_chats_expired', { p_limit: limit });
        if (error) throw new Error(`ai_chats_expired: ${error.message}`);
        return data ?? [];
      },
      async removePhotos(paths) {
        const { error } = await admin.storage.from('ai-chat-photos').remove(paths);
        if (error) throw new Error(error.message);
      },
      async deleteChats(ids) {
        const { error } = await admin.from('ai_chats').delete().in('id', ids);
        if (error) throw new Error(`ai_chats delete: ${error.message}`);
      },
    });
    if (result.photoError) console.error('futty-ai-cleanup: photos not removed, tried again tomorrow:', result.photoError);
    const pendingPostPhotos = await deleteExpiredPendingPhotos({
      async expired(limit) {
        const { data, error } = await admin.rpc('post_photos_pending_expired', { p_limit: limit });
        if (error) throw new Error(`post_photos_pending_expired: ${error.message}`);
        return (data ?? []).map((row: { name: string }) => row.name);
      },
      async remove(paths) {
        const { error } = await admin.storage.from('post-photos').remove(paths);
        if (error) throw new Error(error.message);
      },
    }).catch((err) => {
      console.error('futty-ai-cleanup: unposted post photos not removed, tried again tomorrow:', err);
      return null;
    });
    return new Response(JSON.stringify({ ...result, pendingPostPhotos }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('futty-ai-cleanup failed:', err);
    return new Response('failed', { status: 500 });
  }
});

// DEPLOYMENT (Panos):
//
// 1. Uses the existing CRON_SECRET secret.
//
// 2. Deploy WITHOUT JWT verification (pg_net calls it with the cron secret):
//      supabase functions deploy futty-ai-cleanup --no-verify-jwt
//
// 3. Schedule it once a day (03:00 UTC), the same way as run-payment-jobs:
//      select cron.schedule('futty-ai-cleanup', '0 3 * * *', $$
//        select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/futty-ai-cleanup',
//          headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
//        );
//      $$);
//    A chat goes on the first run after its last message is 7 days old.

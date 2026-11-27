// S7b: posts and comments go live only through here, after the text and
// photo checks (handler.ts). Signed-in players only; the database is called
// with the service role, so create_post_internal and add_comment_internal
// stay out of the app's reach.
//
// DEPLOYMENT (Panos):
//   1. Secrets: ANTHROPIC_API_KEY (existing) and GOOGLE_CLOUD_VISION_API_KEY
//      (new: a Google Cloud API key restricted to the Cloud Vision API).
//      Optional: TEXT_CHECK_MODEL overrides claude-haiku-5-5 without a
//      redeploy.
//   2. supabase functions deploy community-post   (with JWT verification)
//   3. Posts stay off until app_rules.posts_enabled is switched on.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getCallerId } from '../_shared/caller.ts';
import { dbFromSupabase } from '../_shared/db.ts';
import { anthropicTextModel, TEXT_MODEL_ID } from '../_shared/text-check.ts';
import { googleVision } from '../_shared/vision.ts';
import { handle } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const visionApiKey = Deno.env.get('GOOGLE_CLOUD_VISION_API_KEY') ?? '';
const textModelId = Deno.env.get('TEXT_CHECK_MODEL') ?? TEXT_MODEL_ID;

const BUCKET = 'post-photos';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const userId = await getCallerId(req);
  if (!userId) return new Response('Unauthorized', { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  try {
    const result = await handle(
      {
        db: dbFromSupabase(admin),
        textModel: anthropicTextModel(fetch, anthropicApiKey, { model: textModelId }),
        vision: googleVision(fetch, visionApiKey),
        storage: {
          async download(path) {
            const { data, error } = await admin.storage.from(BUCKET).download(path);
            if (error || !data) return null;
            return new Uint8Array(await data.arrayBuffer());
          },
          async move(from, to) {
            const { error } = await admin.storage.from(BUCKET).move(from, to);
            if (error) throw new Error(error.message);
          },
          async remove(paths) {
            if (paths.length === 0) return;
            const { error } = await admin.storage.from(BUCKET).remove(paths);
            if (error) throw new Error(error.message);
          },
        },
        newId: () => crypto.randomUUID(),
      },
      userId,
      body,
    );
    return json(result.status, result.body);
  } catch (err) {
    console.error('community-post failed:', err);
    return json(503, { error: 'check_unavailable' });
  }
});

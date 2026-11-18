// Meta's webhook for the WhatsApp Business Platform (A9). See handler.ts.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { dbFromSupabase } from '../_shared/db.ts';
import { handleRequest } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');

Deno.serve((req) => {
  if (!appSecret || !verifyToken) return new Response('Not configured', { status: 503 });
  const db = dbFromSupabase(createClient(supabaseUrl, serviceRoleKey));
  return handleRequest(req, db, { appSecret, verifyToken });
});

// DEPLOYMENT (Panos, with notify-send-whatsapp):
//
// 1. Secrets: WHATSAPP_APP_SECRET (the Meta app's secret) and
//    WHATSAPP_VERIFY_TOKEN (any long random string, also typed into Meta):
//      supabase secrets set WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=...
//
// 2. Deploy WITHOUT JWT verification (Meta calls it; the signature is the check):
//      supabase functions deploy whatsapp-webhook --no-verify-jwt
//
// 3. In the Meta app: WhatsApp > Configuration > Webhook, callback URL
//      https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook
//    with the same verify token, then subscribe to the "messages" field.

// "Futty AI" — an in-app assistant scoped to answering questions about how
// Futty itself works. The behaviour is in handler.ts and the system prompt,
// built from public.app_rules, in prompt.ts; this file only wires them to
// Supabase and the Anthropic Messages API.
//
// The Messages API is called directly via fetch rather than the
// @anthropic-ai/sdk package: it's a plain JSON REST endpoint, so a direct
// call is simpler and has nothing SDK-specific to break.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { cyprusToday } from '../_shared/cyprus-time.ts';
import { dbFromSupabase } from '../_shared/db.ts';
import { loadRules } from '../_shared/rules.ts';
import { chat, type ModelResponse } from './handler.ts';
import { supabaseChatStore } from './store.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')!;

// Overridable without a redeploy: supabase secrets set ANTHROPIC_MODEL=...
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';

async function callAnthropic(body: Record<string, unknown>): Promise<ModelResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  return await res.json();
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabaseAsUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await supabaseAsUser.auth.getUser();
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401 });
  const userId = userData.user.id;

  let body: { messages?: unknown; chat_id?: unknown; text?: unknown; photos?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  try {
    const result = await chat({
      modelId: MODEL,
      rules: () => loadRules(dbFromSupabase(supabaseAdmin)),
      model: callAnthropic,
      store: supabaseChatStore(supabaseAdmin, userId),
      userDb: dbFromSupabase(supabaseAsUser),
      liveVenues: async ({ city, name }) => {
        let query = supabaseAsUser.from('venues').select('id, name, city').eq('is_live', true);
        if (city) query = query.ilike('city', `%${city}%`);
        if (name) query = query.ilike('name', `%${name}%`);
        const { data, error } = await query.order('name');
        if (error) throw new Error(error.message);
        return data ?? [];
      },
      usage: {
        countSince: async (iso) => {
          const { count } = await supabaseAdmin.from('ai_chat_usage').select('id', { count: 'exact', head: true })
            .eq('profile_id', userId).gte('created_at', iso);
          return count ?? 0;
        },
        record: async () => {
          await supabaseAdmin.from('ai_chat_usage').insert({ profile_id: userId });
        },
      },
      today: cyprusToday,
    }, body);
    return json(result.status, result.body);
  } catch (err) {
    // Logged so the actual reason (bad model name, no API credit, rules
    // unreadable...) shows in Supabase > Edge Functions > Logs. The app only
    // shows a generic "Couldn't reach Futty AI".
    console.error('futty-ai-chat failed:', err instanceof Error ? err.message : err);
    return json(502, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/*
DEPLOYMENT:

1. Set the Anthropic API key:
     supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

2. Deploy:
     supabase functions deploy futty-ai-chat
*/

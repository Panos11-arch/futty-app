// Resolves the signed-in user behind a request, or null.
//
// Edge Functions' default JWT check only proves the request carries *a*
// valid JWT — the public anon key in the app bundle is one too. Any function
// that acts on behalf of a user must look up who that user actually is.

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

export async function getCallerId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const supabaseAsUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await supabaseAsUser.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

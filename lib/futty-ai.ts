import { supabase } from '@/lib/supabase';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/** Sends the whole conversation so far — the Edge Function is stateless, no
 *  server-side chat history, so the client is the only place this lives
 *  (kept for the whole app session, not reset on close — see
 *  components/futty-ai-chat.tsx). */
export async function sendFuttyAiMessage(messages: ChatMessage[]) {
  return supabase.functions.invoke<{ reply: string }>('futty-ai-chat', {
    body: { messages },
  });
}

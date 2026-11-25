// S13A: the caller's saved Futty AI chats, in public.ai_chats,
// public.ai_chat_messages and the private ai-chat-photos bucket. Uses the
// service role (players can't write their chats), so every query here is
// scoped to the caller's own id.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ChatStore, StoredMessage } from './handler.ts';

export const AI_PHOTO_BUCKET = 'ai-chat-photos';
const COLUMNS = 'id, role, body, actions, photo_paths, created_at';

export function supabaseChatStore(admin: SupabaseClient, userId: string): ChatStore {
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };

  return {
    async ownsChat(chatId) {
      const { data, error } = await admin.from('ai_chats').select('id').eq('id', chatId).eq('profile_id', userId).maybeSingle();
      fail('ai_chats read', error);
      return !!data;
    },

    async history(chatId, limit) {
      const { data, error } = await admin
        .from('ai_chat_messages')
        .select(COLUMNS)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(limit);
      fail('ai_chat_messages read', error);
      return ((data ?? []) as StoredMessage[]).reverse();
    },

    newChatId: () => crypto.randomUUID(),

    async savePhotos(chatId, photos) {
      const paths: string[] = [];
      for (const bytes of photos) {
        const path = `${userId}/${chatId}/${crypto.randomUUID()}.jpg`;
        const { error } = await admin.storage.from(AI_PHOTO_BUCKET).upload(path, bytes, { contentType: 'image/jpeg' });
        if (error) {
          if (paths.length > 0) await admin.storage.from(AI_PHOTO_BUCKET).remove(paths);
          throw new Error(`photo upload: ${error.message}`);
        }
        paths.push(path);
      }
      return paths;
    },

    async removePhotos(paths) {
      const { error } = await admin.storage.from(AI_PHOTO_BUCKET).remove(paths);
      fail('photo remove', error);
    },

    async createChat(chatId, title) {
      const { error } = await admin.from('ai_chats').insert({ id: chatId, profile_id: userId, title });
      fail('ai_chats insert', error);
    },

    async addMessages(chatId, messages) {
      const { data, error } = await admin
        .from('ai_chat_messages')
        .insert(messages.map((m) => ({ ...m, chat_id: chatId })))
        .select(COLUMNS);
      fail('ai_chat_messages insert', error);
      const last = messages.at(-1)?.created_at;
      if (last) {
        const bumped = await admin.from('ai_chats').update({ last_message_at: last }).eq('id', chatId).eq('profile_id', userId);
        fail('ai_chats update', bumped.error);
      }
      return ((data ?? []) as StoredMessage[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
  };
}

import 'expo-sqlite/localStorage/install';

// The import above installs a synchronous, SQLite-backed `localStorage` global,
// which is what supabase-js wants for persisting a session on native.
export const authStorage = localStorage;

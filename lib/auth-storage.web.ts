// Browsers already ship a persistent localStorage, so web skips expo-sqlite
// entirely — its wa-sqlite wasm asset does not resolve under Metro for web,
// which fails the bundle outright.
//
// `window` is absent while Expo prerenders the static web output; supabase-js
// falls back to in-memory storage when this is undefined.
export const authStorage = typeof window === 'undefined' ? undefined : window.localStorage;

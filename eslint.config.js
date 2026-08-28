// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Deno runtime (Deno.serve, npm: specifiers) — not part of the app's lint/type surface.
    ignores: ['dist/*', 'supabase/functions/**'],
  },
]);

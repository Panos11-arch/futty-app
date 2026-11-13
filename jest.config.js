// Jest for the app (lib/, components/, app/). Supabase Edge Functions are
// Deno and have their own tests: `deno test --node-modules-dir=none supabase/functions/`.
const fs = require('node:fs');
const path = require('node:path');

// Money maths must be fully covered. Jest fails a coverage threshold whose
// folder matches no files, so the threshold only switches on once lib/money/
// exists (P4a). From then on it can't be skipped.
const moneyDir = path.join(__dirname, 'lib', 'money');
const hasMoneyCode = fs.existsSync(moneyDir);

// npm installs expo-modules-core under node_modules/expo/ rather than at the
// top level, where jest-expo's setup looks for it. Point Jest at expo's copy.
const expoModulesCore = path.dirname(
  require.resolve('expo-modules-core/package.json', { paths: [require.resolve('expo/package.json')] }),
);

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^expo-modules-core$': expoModulesCore,
    '^expo-modules-core/(.*)$': `${expoModulesCore}/$1`,
    // No native module under Jest: the package's own in-memory mock, for every test.
    '^@react-native-async-storage/async-storage$': '@react-native-async-storage/async-storage/jest/async-storage-mock',
  },
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/supabase/'],
  // Counting every money file means one no test imports shows as 0%, not as
  // missing (and so silently passing).
  collectCoverage: hasMoneyCode,
  collectCoverageFrom: hasMoneyCode ? ['lib/money/**/*.{ts,tsx}', '!**/*.test.{ts,tsx}'] : undefined,
  coverageThreshold: hasMoneyCode ? { './lib/money/': { lines: 100 } } : undefined,
};

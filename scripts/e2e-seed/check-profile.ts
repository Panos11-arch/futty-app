// The e2e workflow's first job (.eas/workflows/e2e.yml): stops before any
// build or seed while eas.json's e2e-test profile still has a REPLACE_
// placeholder, points at production or holds a live Stripe key.
//
//   npx --yes tsx@4.20.6 scripts/e2e-seed/check-profile.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { e2eProfileProblems } from '../../lib/e2e-guard';

/** The problems, in words; empty when the profile is ready. */
export function checkProfile(easJsonText: string): string[] {
  return e2eProfileProblems(JSON.parse(easJsonText), { allowPlaceholders: false });
}

if (typeof require !== 'undefined' && require.main === module) {
  const problems = checkProfile(readFileSync(path.join(__dirname, '..', '..', 'eas.json'), 'utf8'));
  if (problems.length > 0) {
    console.error('The e2e-test profile in eas.json is not ready:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Fill in the staging values (docs/testing/maestro.md, "Setting up staging"), then run again.');
    process.exit(1);
  }
  console.log('e2e-test profile: staging Supabase and Stripe test keys, no placeholders.');
}

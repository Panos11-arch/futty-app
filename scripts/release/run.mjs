#!/usr/bin/env node
// The release steps (P7). See docs/release-checklist.md and release.ts.
// Needs Node 24 (it runs release.ts directly).
//
//   node scripts/release/run.mjs <demo-account | unlive-unsigned | check> [--allow-remote]
//
// Uses SUPABASE_URL (default the local stack) and SUPABASE_SERVICE_ROLE_KEY.
// A URL that isn't local is refused unless --allow-remote is given: only
// Panos runs these against production. demo-account also needs
// FUTTY_DEMO_PASSWORD.
import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import {
  DEMO_EMAIL,
  demoUserAttributes,
  describeCheck,
  isLocalUrl,
  parseCommand,
  readDemoPassword,
} from './release.ts';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'allow-remote': { type: 'boolean', default: false } },
});

const command = parseCommand(positionals[0]);
if (!command) {
  console.error('Usage: node scripts/release/run.mjs <demo-account | unlive-unsigned | check> [--allow-remote]');
  process.exit(2);
}

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
if (!isLocalUrl(url) && !args['allow-remote']) {
  console.error(`Refusing to use ${url}: not local. Pass --allow-remote to run against it.`);
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

if (command === 'demo-account') {
  const read = readDemoPassword(process.env);
  if ('error' in read) {
    console.error(read.error);
    process.exit(2);
  }
  const { data: existing, error: findError } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', DEMO_EMAIL)
    .maybeSingle();
  if (findError) throw new Error(`find ${DEMO_EMAIL}: ${findError.message}`);

  const attributes = demoUserAttributes(read.password);
  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: attributes.password,
      email_confirm: true,
    });
    if (error) throw new Error(`update ${DEMO_EMAIL}: ${error.message}`);
    console.log(`${DEMO_EMAIL} exists; its password was reset to FUTTY_DEMO_PASSWORD.`);
  } else {
    const { error } = await supabase.auth.admin.createUser(attributes);
    if (error) throw new Error(`create ${DEMO_EMAIL}: ${error.message}`);
    console.log(`${DEMO_EMAIL} created.`);
  }
} else if (command === 'unlive-unsigned') {
  const { data, error } = await supabase.rpc('release_unlive_unsigned');
  if (error) throw new Error(`release_unlive_unsigned: ${error.message}`);
  console.log(`Switched off ${data} unsigned venue(s).`);
} else {
  const { data, error } = await supabase.rpc('release_check', { p_demo_email: DEMO_EMAIL });
  if (error) throw new Error(`release_check: ${error.message}`);
  for (const line of describeCheck(data)) console.log(line);
  process.exit(data.ok ? 0 : 1);
}

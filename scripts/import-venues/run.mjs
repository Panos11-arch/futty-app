#!/usr/bin/env node
// Venue data import (spec 13, "Venue pages and the venue data import").
// Reads the two CSVs exported from the venue sheet, uploads the photos that
// have permission, and writes the SQL that imports every venue. See
// README.md. Needs Node 24 (it runs venue-import.ts directly).
//
//   node scripts/import-venues/run.mjs --venues <venues.csv> --items <venue_items.csv>
//        [--photos <photos folder>] [--mapping <mapping.json>] [--out <import.sql>]
//        [--allow-remote]
//
// --out defaults to venue-import.sql next to the venues CSV, outside the repo.
//
// Photos are uploaded through the Storage API at SUPABASE_URL (default the
// local stack) with SUPABASE_SERVICE_ROLE_KEY. A URL that isn't local is
// refused unless --allow-remote is given. No venue with photo permission
// means no upload and no key needed.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { buildImport, isLocalUrl, parseCsv, toRows, toSql, uploadPhotos } from './venue-import.ts';

const { values: args } = parseArgs({
  options: {
    venues: { type: 'string' },
    items: { type: 'string' },
    photos: { type: 'string' },
    mapping: { type: 'string' },
    out: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
  },
});

if (!args.venues || !args.items) {
  console.error('Usage: node scripts/import-venues/run.mjs --venues <venues.csv> --items <venue_items.csv> [--photos <dir>] [--mapping <file>] [--out <file>]');
  process.exit(2);
}

const out = args.out ?? path.join(path.dirname(path.resolve(args.venues)), 'venue-import.sql');

const readCsv = (file) => toRows(parseCsv(readFileSync(file, 'utf8')));
const listFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => statSync(path.join(dir, f)).isFile()) : [];

const photosDir = args.photos ? path.resolve(args.photos) : '';
const venuePhotos = {};
if (photosDir && existsSync(photosDir)) {
  for (const entry of readdirSync(photosDir)) {
    if (entry !== 'items' && statSync(path.join(photosDir, entry)).isDirectory()) {
      venuePhotos[entry] = listFiles(path.join(photosDir, entry));
    }
  }
}

const plan = buildImport({
  venues: readCsv(args.venues),
  items: readCsv(args.items),
  venuePhotos,
  itemPhotos: photosDir ? listFiles(path.join(photosDir, 'items')) : [],
  mapping: args.mapping ? JSON.parse(readFileSync(args.mapping, 'utf8')) : {},
  photosDir,
});

if (plan.uploads.length > 0) {
  const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isLocalUrl(url) && !args['allow-remote']) {
    console.error(`Refusing to upload to ${url}: not local. Pass --allow-remote to upload there.`);
    process.exit(2);
  }
  if (!key) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is needed to upload photos.');
    process.exit(2);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const storage = createClient(url, key, { auth: { persistSession: false } }).storage.from('venue-photos');
  const uploaded = await uploadPhotos(plan.uploads, async (u) => {
    const { error } = await storage.upload(u.storagePath, readFileSync(u.localPath), { upsert: true, contentType: u.contentType });
    if (error) throw new Error(`upload ${u.storagePath}: ${error.message}`);
  });
  console.log(`Uploaded ${uploaded} photo(s).`);
}

writeFileSync(out, toSql(plan.venues, new Date().toISOString()));

const counts = plan.venues.reduce(
  (n, v) => ({
    hours: n.hours + v.hours.length,
    amenities: n.amenities + v.amenities.length,
    photos: n.photos + v.photos.length,
    items: n.items + v.items.length,
  }),
  { hours: 0, amenities: 0, photos: 0, items: 0 },
);
console.log(
  `${plan.venues.length} venue(s), ${counts.hours} day(s) of hours, ${counts.amenities} amenities, ` +
    `${counts.photos} photo(s), ${counts.items} item(s). SQL written to ${out}.`,
);
if (plan.report.length > 0) {
  console.log(`\nNot imported (${plan.report.length}):`);
  for (const line of plan.report) console.log(`  - ${line}`);
}

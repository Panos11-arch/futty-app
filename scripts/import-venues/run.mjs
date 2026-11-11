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
// With SUPABASE_SERVICE_ROLE_KEY set, storage is brought in line through
// the Storage API at SUPABASE_URL (default the local stack): photos with
// permission are uploaded, and every other file in an imported venue's
// folders is deleted (permission withdrawn, photo dropped from the sheet).
// A URL that isn't local is refused unless --allow-remote is given. Without
// the key nothing in storage is touched, which is only allowed when there's
// nothing to upload.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { buildImport, isLocalUrl, parseCsv, syncStorage, toRows, toSql } from './venue-import.ts';

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

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (key) {
  if (!isLocalUrl(url) && !args['allow-remote']) {
    console.error(`Refusing to use storage at ${url}: not local. Pass --allow-remote to use it.`);
    process.exit(2);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from('venue-photos');
  const listFolder = async (folder) => {
    const { data, error } = await bucket.list(folder, { limit: 1000 });
    if (error) throw new Error(`list ${folder}: ${error.message}`);
    // Folders come back without an id.
    return (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
  };
  const result = await syncStorage(plan, {
    list: async (importKey) => [...(await listFolder(importKey)), ...(await listFolder(`${importKey}/items`))],
    upload: async (u) => {
      const { error } = await bucket.upload(u.storagePath, readFileSync(u.localPath), { upsert: true, contentType: u.contentType });
      if (error) throw new Error(`upload ${u.storagePath}: ${error.message}`);
    },
    remove: async (paths) => {
      const { error } = await bucket.remove(paths);
      if (error) throw new Error(`delete ${paths.join(', ')}: ${error.message}`);
    },
  });
  console.log(`Storage: ${result.uploaded} photo(s) uploaded, ${result.deleted.length} deleted.`);
  for (const p of result.deleted) console.log(`  - deleted ${p}`);
} else if (plan.uploads.length > 0) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is needed to upload photos.');
  process.exit(2);
} else {
  console.log(
    'Storage not checked (no SUPABASE_SERVICE_ROLE_KEY): files of venues without photo permission were not deleted. ' +
      'Players still can\'t read them, since no venue_photos row points to them. Set the key to delete them.',
  );
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

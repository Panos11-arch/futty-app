// The venue data import (spec 13, "Venue pages and the venue data import",
// decided 11 November): turns the two CSVs exported from the venue sheet
// into one import_venue payload per venue, the photos to upload, and a
// report of every cell that wasn't imported. No file or network access here
// (run.mjs does that), so all of it is tested.
//
// Rules:
//   - blank cells stay empty; a price, a time or a day list that can't be
//     read is left empty and reported, never guessed;
//   - no pitches and no prices: the sheet has no named pitches, and
//     price_peak / price_offpeak aren't used yet (peak pricing isn't decided);
//   - a close of "00:00" is the end of that day (23:59:59); a close after
//     midnight isn't supported yet, so that day is skipped and reported;
//   - photos only when photo_permission_given is yes; the venue is imported
//     either way;
//   - amenities: "yes" (a bracketed note is kept, a source note like
//     "(per activeplanet.com)" isn't), "no" isn't shown, anything else is
//     skipped and reported;
//   - venues are matched on venue_id (V001...), or on an existing venue's id
//     from the optional mapping file; never by name.

export type Row = Record<string, string>;

export type VenuePayload = {
  import_key: string;
  existing_venue_id?: string;
  name: string;
  city: string | null;
  address: string | null;
  google_maps_link: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  pitches_summary: string | null;
  sheet_status: string | null;
  notes: string | null;
  photo_permission: boolean;
  hours: { weekday: number; opens: string; closes: string }[];
  amenities: { kind: AmenityKind; note: string | null }[];
  photos: { storage_path: string; sort_order: number }[];
  items: ItemPayload[];
};

export type ItemPayload = {
  name: string;
  category: string | null;
  description: string | null;
  price_cents: number | null;
  available_from: string | null;
  available_to: string | null;
  available_weekdays: number[] | null;
  is_post_match_offer: boolean;
  offer_text: string | null;
  offer_price_cents: number | null;
  photo_path: string | null;
  dietary_tags: string[] | null;
  active: boolean;
};

export type Upload = { localPath: string; storagePath: string; contentType: string };

export type ImportInput = {
  venues: Row[];
  items: Row[];
  /** Photo file names found in photos/<venue_id>/, per venue_id. */
  venuePhotos: Record<string, string[]>;
  /** Photo file names found in photos/items/. */
  itemPhotos: string[];
  /** import_key -> existing venue id, from the optional mapping file. */
  mapping: Record<string, string>;
  /** Where the photos folder is, to build local paths for uploads. */
  photosDir: string;
};

export type ImportPlan = { venues: VenuePayload[]; uploads: Upload[]; report: string[] };

export const AMENITY_COLUMNS = {
  parking: 'parking',
  changing_rooms: 'changing_rooms',
  showers: 'showers',
  lockers: 'lockers',
  cafe_or_bar: 'cafe_or_bar',
  floodlights: 'floodlights',
  bibs_provided: 'bibs',
  ball_hire: 'ball_hire',
  first_aid: 'first_aid',
  wifi: 'wifi',
} as const;
export type AmenityKind = (typeof AMENITY_COLUMNS)[keyof typeof AMENITY_COLUMNS] | 'other';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const PHOTO_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMPORT_KEY = /^V[0-9]{3,}$/;

/** Parses CSV text (RFC 4180: quoted fields, doubled quotes, newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV rows as objects keyed by the header row; fully blank rows dropped. */
export function toRows(table: string[][]): Row[] {
  const [header, ...rest] = table;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rest
    .filter((cells) => cells.some((c) => c.trim() !== ''))
    .map((cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ''])));
}

function text(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  return v === '' ? null : v;
}

/** "3.00", "3", "3,5" or "€3.00" -> 300 cents, from the text (never through a float). Null if unreadable. */
export function eurosToCents(value: string): number | null {
  const m = value.trim().replace(/^(€|eur)\s*/i, '').match(/^(\d+)(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** "7:00" or "07:00" -> "07:00:00"; null if unreadable. */
export function readTime(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}:00`;
}

type Span = { opens: string; closes: string } | { problem: string };

/** An opening and closing time. A close of 00:00 is the end of the day; a
 *  close after midnight (earlier than the opening) isn't supported yet. */
export function readSpan(open: string, close: string): Span {
  const opens = readTime(open);
  const closes = readTime(close);
  if (!opens || !closes) return { problem: `unreadable times "${open}"-"${close}"` };
  if (closes === '00:00:00') return { opens, closes: '23:59:59' };
  if (closes <= opens) return { problem: `closes after midnight ("${close}"), not supported yet` };
  return { opens, closes };
}

const DAY_NUMBER: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/** "Mon-Sun", "Mon-Fri; Sun", "Sat, Sun" -> ISO weekdays; null if unreadable. */
export function readWeekdays(value: string): number[] | null {
  const days = new Set<number>();
  const parts = value.split(/[;,]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const m = part.match(/^([a-z]{3})[a-z]*(?:\s*-\s*([a-z]{3})[a-z]*)?$/);
    const from = m ? DAY_NUMBER[m[1]] : undefined;
    const to = m?.[2] ? DAY_NUMBER[m[2]] : from;
    if (!from || !to || to < from) return null;
    for (let d = from; d <= to; d++) days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

type Amenity = { has: true; note: string | null; dropped?: string } | { has: false } | { problem: string };

/** One amenity cell: "yes", "yes (free)", "no - ...", or something else. */
export function readAmenity(value: string): Amenity {
  const v = value.trim();
  if (/^no\b/i.test(v)) return { has: false };
  const m = v.match(/^yes\b\s*(.*)$/i);
  if (!m) return { problem: `"${v}" is neither yes nor no` };
  const rest = m[1].trim();
  if (rest === '') return { has: true, note: null };
  const bracket = rest.match(/^\((.*)\)$/);
  if (bracket) {
    const note = bracket[1].trim();
    return /^(per|source|via)\b/i.test(note) ? { has: true, note: null } : { has: true, note: note || null };
  }
  return { has: true, note: null, dropped: rest };
}

function yes(value: string | undefined): boolean {
  return /^yes\b/i.test((value ?? '').trim());
}

/** Builds the import from the two sheets. Pure: the same input always gives the same plan. */
export function buildImport(input: ImportInput): ImportPlan {
  const report: string[] = [];
  const uploads: Upload[] = [];
  const venues: VenuePayload[] = [];
  const seen = new Set<string>();

  for (const [key, id] of Object.entries(input.mapping)) {
    if (!IMPORT_KEY.test(key) || !UUID.test(id)) throw new Error(`mapping: "${key}" -> "${id}" isn't a venue_id and a venue uuid`);
  }

  for (const row of input.venues) {
    const key = text(row.venue_id);
    if (!key) continue;
    if (!IMPORT_KEY.test(key)) {
      report.push(`${key}: not a venue_id (V001...), skipped`);
      continue;
    }
    if (seen.has(key)) {
      report.push(`${key}: appears twice, the second row is skipped`);
      continue;
    }
    const name = text(row.venue_name);
    if (!name) {
      report.push(`${key}: no venue_name, skipped`);
      continue;
    }
    seen.add(key);

    const permission = yes(row.photo_permission_given);
    const venue: VenuePayload = {
      import_key: key,
      ...(input.mapping[key] ? { existing_venue_id: input.mapping[key] } : {}),
      name,
      city: text(row.city),
      address: text(row.address),
      google_maps_link: text(row.google_maps_link),
      phone: text(row.phone),
      website: text(row.website),
      instagram: text(row.instagram),
      pitches_summary: text(row.pitch_size),
      sheet_status: text(row.status),
      notes: text(row.notes),
      photo_permission: permission,
      hours: [],
      amenities: [],
      photos: [],
      items: [],
    };

    DAYS.forEach((day, i) => {
      const open = text(row[`${day}_open`]);
      const close = text(row[`${day}_close`]);
      if (!open && !close) return;
      if (!open || !close) {
        report.push(`${key}: ${day} has only one of open/close, that day's hours skipped`);
        return;
      }
      const span = readSpan(open, close);
      if ('problem' in span) report.push(`${key}: ${day} ${span.problem}, that day's hours skipped`);
      else venue.hours.push({ weekday: i + 1, ...span });
    });

    for (const [column, kind] of Object.entries(AMENITY_COLUMNS)) {
      const cell = text(row[column]);
      if (!cell) continue;
      const amenity = readAmenity(cell);
      if ('problem' in amenity) report.push(`${key}: ${column} ${amenity.problem}, skipped`);
      else if (amenity.has) {
        venue.amenities.push({ kind, note: amenity.note });
        if (amenity.dropped) report.push(`${key}: ${column} counted as yes; "${amenity.dropped}" not kept`);
      }
    }
    const other = text(row.other_after_sales_services);
    if (other) venue.amenities.push({ kind: 'other', note: other });

    if (text(row.price_peak_eur_per_hour) || text(row.price_offpeak_eur_per_hour) || text(row.peak_hours)) {
      report.push(`${key}: price columns not imported (peak pricing isn't decided); no price, so it can't be booked`);
    }
    const pitchFields = ['pitch_name', 'surface', 'indoor_or_outdoor', 'max_format', 'combines_with'].filter((c) => text(row[c]));
    if (pitchFields.length > 0) report.push(`${key}: no pitches imported (${pitchFields.join(', ')} kept in the sheet only)`);

    const files = [...(input.venuePhotos[key] ?? [])].sort();
    if (permission) {
      files.forEach((file, i) => {
        const type = contentType(file);
        if (!type) {
          report.push(`${key}: photo ${file} isn't a jpg, png or webp, skipped`);
          return;
        }
        const storagePath = `${key}/${file}`;
        venue.photos.push({ storage_path: storagePath, sort_order: i + 1 });
        uploads.push({ localPath: `${input.photosDir}/${key}/${file}`, storagePath, contentType: type });
      });
    } else if (files.length > 0) {
      report.push(`${key}: ${files.length} photo(s) not imported, no photo permission`);
    }

    venues.push(venue);
  }

  const byKey = new Map(venues.map((v) => [v.import_key, v]));
  // Row 2 of "Venue items" is the sheet's example: always skipped.
  input.items.slice(1).forEach((row, i) => {
    const where = `items row ${i + 3}`;
    const key = text(row.venue_id);
    const name = text(row.item_name);
    if (!key && !name) return;
    const venue = key ? byKey.get(key) : undefined;
    if (!venue) {
      report.push(`${where}: venue_id "${key ?? ''}" isn't an imported venue, skipped`);
      return;
    }
    if (!name) {
      report.push(`${where}: no item_name, skipped`);
      return;
    }
    if (venue.items.some((it) => it.name === name)) {
      report.push(`${where}: ${key} already has an item "${name}", skipped`);
      return;
    }

    const cents = (column: string) => {
      const cell = text(row[column]);
      if (!cell) return null;
      const value = eurosToCents(cell);
      if (value === null) report.push(`${where}: ${column} "${cell}" unreadable, left empty`);
      return value;
    };

    let from: string | null = null;
    let to: string | null = null;
    const fromCell = text(row.available_from);
    const toCell = text(row.available_to);
    if (fromCell && toCell) {
      const span = readSpan(fromCell, toCell);
      if ('problem' in span) report.push(`${where}: available times ${span.problem}, left empty`);
      else ({ opens: from, closes: to } = span);
    } else if (fromCell || toCell) {
      report.push(`${where}: only one of available_from/available_to, left empty`);
    }

    let weekdays: number[] | null = null;
    const daysCell = text(row.days_available);
    if (daysCell) {
      weekdays = readWeekdays(daysCell);
      if (!weekdays) report.push(`${where}: days_available "${daysCell}" unreadable, left empty`);
    }

    const activeCell = text(row.active);
    if (!activeCell) report.push(`${where}: active is blank, imported as not active`);
    else if (!/^(yes|no)\b/i.test(activeCell)) report.push(`${where}: active "${activeCell}" isn't yes or no, imported as not active`);

    const offerCell = text(row.is_post_match_offer);
    if (offerCell && !/^(yes|no)\b/i.test(offerCell)) {
      report.push(`${where}: is_post_match_offer "${offerCell}" isn't yes or no, imported as not an offer`);
    }

    let photoPath: string | null = null;
    const photo = text(row.photo_file_name);
    if (photo) {
      if (!venue.photo_permission) report.push(`${where}: photo ${photo} not imported, no photo permission`);
      else if (!input.itemPhotos.includes(photo)) report.push(`${where}: photo ${photo} not found in photos/items`);
      else if (!contentType(photo)) report.push(`${where}: photo ${photo} isn't a jpg, png or webp, skipped`);
      else {
        photoPath = `${key}/items/${photo}`;
        uploads.push({ localPath: `${input.photosDir}/items/${photo}`, storagePath: photoPath, contentType: contentType(photo)! });
      }
    }

    const tags = text(row.dietary_tags);
    venue.items.push({
      name,
      category: text(row.category),
      description: text(row.description),
      price_cents: cents('price_eur'),
      available_from: from,
      available_to: to,
      available_weekdays: weekdays,
      is_post_match_offer: yes(offerCell ?? ''),
      offer_text: text(row.offer_text),
      offer_price_cents: cents('offer_price_eur'),
      photo_path: photoPath,
      dietary_tags: tags ? tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : null,
      active: yes(activeCell ?? ''),
    });
  });

  return { venues, uploads, report };
}

function contentType(file: string): string | null {
  return PHOTO_TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/** The SQL that imports every venue, in one transaction. */
export function toSql(venues: VenuePayload[], generatedAt: string): string {
  const lines = [
    `-- Venue import, generated by scripts/import-venues at ${generatedAt}.`,
    `-- ${venues.length} venue(s). One transaction: all of it or none of it. Safe to run again.`,
    'begin;',
  ];
  for (const venue of venues) {
    const json = JSON.stringify(venue);
    if (json.includes('$venue$')) throw new Error(`${venue.import_key}: contains "$venue$"`);
    lines.push(`select public.import_venue($venue$${json}$venue$::jsonb);`);
  }
  lines.push('commit;', '');
  return lines.join('\n');
}

export type Uploader = (upload: Upload) => Promise<void>;

/** Uploads every photo (overwriting, so a second run changes nothing). Stops at the first failure. */
export async function uploadPhotos(uploads: Upload[], upload: Uploader): Promise<number> {
  for (const item of uploads) await upload(item);
  return uploads.length;
}

/** Storage files to delete: every file in an imported venue's folders
 *  (<venue_id>/ and <venue_id>/items/) that this import doesn't upload.
 *  That's every file of a venue whose photo permission was withdrawn, and
 *  any photo dropped from the sheet. Other venues' folders aren't touched. */
export function filesToDelete(plan: ImportPlan, existing: Record<string, string[]>): string[] {
  const keep = new Set(plan.uploads.map((u) => u.storagePath));
  const imported = new Set(plan.venues.map((v) => v.import_key));
  return Object.entries(existing)
    .filter(([key]) => imported.has(key))
    .flatMap(([, paths]) => paths)
    .filter((path) => !keep.has(path))
    .sort();
}

export type StorageClient = {
  /** Every file path under one venue's folders, e.g. ["V001/a.jpg", "V001/items/x.jpg"]. */
  list: (importKey: string) => Promise<string[]>;
  upload: Uploader;
  remove: (paths: string[]) => Promise<void>;
};

/** Brings storage in line with the import: uploads its photos, then deletes
 *  the files it no longer has (permission withdrawn, photo dropped). */
export async function syncStorage(plan: ImportPlan, storage: StorageClient) {
  const existing: Record<string, string[]> = {};
  for (const venue of plan.venues) existing[venue.import_key] = await storage.list(venue.import_key);
  const uploaded = await uploadPhotos(plan.uploads, storage.upload);
  const doomed = filesToDelete(plan, existing);
  if (doomed.length > 0) await storage.remove(doomed);
  return { uploaded, deleted: doomed };
}

/** Only the local stack, unless the person running it says otherwise. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

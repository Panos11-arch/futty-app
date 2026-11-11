import {
  buildImport,
  eurosToCents,
  type ImportInput,
  isLocalUrl,
  parseCsv,
  readAmenity,
  readSpan,
  readWeekdays,
  type Row,
  toRows,
  toSql,
  uploadPhotos,
} from './venue-import';

const venueRow = (over: Row = {}): Row => ({
  venue_id: 'V001',
  venue_name: 'Nuevo Campo',
  city: 'Nicosia (Strovolos)',
  address: '2 Aristidou Street, Latsia',
  google_maps_link: 'https://www.google.com/maps/place/?q=place_id:abc',
  phone: '+357 99 530500',
  website: '',
  instagram: '',
  status: 'prospect',
  pitch_size: '4 futsal pitches',
  mon_open: '15:00',
  mon_close: '22:30',
  sat_open: '08:00',
  sat_close: '00:00',
  parking: 'yes (free)',
  showers: 'yes (per activeplanet.com)',
  cafe_or_bar: 'yes',
  ball_hire: 'no - bring your own balls',
  wifi: '',
  photo_permission_given: '',
  notes: 'Source: Google Maps.',
  ...over,
});

const example: Row = { venue_id: 'V000', item_name: 'EXAMPLE - delete this row', price_eur: '3.00', active: 'yes' };
const lemonade: Row = {
  venue_id: 'V001',
  item_name: 'Lemonade',
  category: 'drink',
  description: 'Fresh lemonade with mint, 500 ml',
  price_eur: '3.00',
  available_from: '15:00',
  available_to: '22:30',
  days_available: 'Mon-Sun',
  is_post_match_offer: 'yes',
  offer_text: 'Lemonade after your match',
  offer_price_eur: '2.50',
  photo_file_name: 'lemonade.jpg',
  dietary_tags: 'vegan; gluten-free',
  active: 'yes',
};

const input = (over: Partial<ImportInput> = {}): ImportInput => ({
  venues: [venueRow()],
  items: [example, lemonade],
  venuePhotos: { V001: ['b.jpg', 'a.jpg'] },
  itemPhotos: ['lemonade.jpg'],
  mapping: {},
  photosDir: '/data/photos',
  ...over,
});

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, commas and newlines in quotes', () => {
    expect(parseCsv('a,b,c\r\n"x, y","say ""hi""","two\nlines"\n')).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\nlines'],
    ]);
  });

  it('drops a byte-order mark and blank rows, and keys rows by the header', () => {
    expect(toRows(parseCsv('﻿venue_id,venue_name\nV001,A\n,\nV002,B'))).toEqual([
      { venue_id: 'V001', venue_name: 'A' },
      { venue_id: 'V002', venue_name: 'B' },
    ]);
  });

  it('refuses a file that ends inside quotes', () => {
    expect(() => parseCsv('a,"b')).toThrow('quoted');
  });
});

describe('cell readers', () => {
  it('turns euros into whole cents from the text', () => {
    expect(eurosToCents('3.00')).toBe(300);
    expect(eurosToCents('2.5')).toBe(250);
    expect(eurosToCents('4')).toBe(400);
    expect(eurosToCents('0,10')).toBe(10);
    expect(eurosToCents('€ 12.99')).toBe(1299);
    expect(eurosToCents('about 3')).toBeNull();
    expect(eurosToCents('3.999')).toBeNull();
    expect(eurosToCents('-1')).toBeNull();
  });

  it('reads a 00:00 close as the end of that day and refuses a close after midnight', () => {
    expect(readSpan('15:00', '22:30')).toEqual({ opens: '15:00:00', closes: '22:30:00' });
    expect(readSpan('8:00', '00:00')).toEqual({ opens: '08:00:00', closes: '23:59:59' });
    expect(readSpan('18:00', '01:00')).toEqual({ problem: expect.stringContaining('after midnight') });
    expect(readSpan('18:00', '24:00')).toEqual({ problem: expect.stringContaining('unreadable') });
    expect(readSpan('morning', '22:00')).toEqual({ problem: expect.stringContaining('unreadable') });
  });

  it('reads day lists and refuses anything else', () => {
    expect(readWeekdays('Mon-Sun')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(readWeekdays('Mon-Fri; Sun')).toEqual([1, 2, 3, 4, 5, 7]);
    expect(readWeekdays('Saturday, Sunday')).toEqual([6, 7]);
    expect(readWeekdays('Fri-Mon')).toBeNull();
    expect(readWeekdays('every day')).toBeNull();
  });

  it('reads amenities: yes with a note, a source note dropped, no, and anything else', () => {
    expect(readAmenity('yes')).toEqual({ has: true, note: null });
    expect(readAmenity('yes (free)')).toEqual({ has: true, note: 'free' });
    expect(readAmenity('yes (per activeplanet.com)')).toEqual({ has: true, note: null });
    expect(readAmenity('no - bring your own balls')).toEqual({ has: false });
    expect(readAmenity('equipment rental listed')).toEqual({ problem: expect.stringContaining('neither yes nor no') });
  });
});

describe('buildImport', () => {
  it('imports the venue with exactly what the sheet says: blank cells stay empty, no price, no pitch', () => {
    const [venue] = buildImport(input()).venues;
    expect(venue).toMatchObject({
      import_key: 'V001',
      name: 'Nuevo Campo',
      website: null,
      instagram: null,
      pitches_summary: '4 futsal pitches',
      sheet_status: 'prospect',
      hours: [
        { weekday: 1, opens: '15:00:00', closes: '22:30:00' },
        { weekday: 6, opens: '08:00:00', closes: '23:59:59' },
      ],
      amenities: [
        { kind: 'parking', note: 'free' },
        { kind: 'showers', note: null },
        { kind: 'cafe_or_bar', note: null },
      ],
    });
    expect(venue).not.toHaveProperty('existing_venue_id');
    expect(Object.keys(venue)).not.toEqual(expect.arrayContaining(['price_cents', 'prices', 'pitches', 'is_live']));
  });

  it('a photo without permission isn\'t imported, but its venue is', () => {
    const plan = buildImport(input());
    expect(plan.venues).toHaveLength(1);
    expect(plan.venues[0].photo_permission).toBe(false);
    expect(plan.venues[0].photos).toEqual([]);
    expect(plan.venues[0].items[0].photo_path).toBeNull();
    expect(plan.uploads).toEqual([]);
    expect(plan.report).toEqual(
      expect.arrayContaining([
        'V001: 2 photo(s) not imported, no photo permission',
        'items row 3: photo lemonade.jpg not imported, no photo permission',
      ]),
    );
  });

  it('with permission, photos are uploaded under the venue_id, in file-name order', () => {
    const plan = buildImport(input({ venues: [venueRow({ photo_permission_given: 'yes' })] }));
    expect(plan.venues[0].photos).toEqual([
      { storage_path: 'V001/a.jpg', sort_order: 1 },
      { storage_path: 'V001/b.jpg', sort_order: 2 },
    ]);
    expect(plan.venues[0].items[0].photo_path).toBe('V001/items/lemonade.jpg');
    expect(plan.uploads).toEqual([
      { localPath: '/data/photos/V001/a.jpg', storagePath: 'V001/a.jpg', contentType: 'image/jpeg' },
      { localPath: '/data/photos/V001/b.jpg', storagePath: 'V001/b.jpg', contentType: 'image/jpeg' },
      { localPath: '/data/photos/items/lemonade.jpg', storagePath: 'V001/items/lemonade.jpg', contentType: 'image/jpeg' },
    ]);
  });

  it('skips the example row and imports the items with prices in cents', () => {
    const { venues } = buildImport(input());
    expect(venues[0].items).toEqual([
      {
        name: 'Lemonade',
        category: 'drink',
        description: 'Fresh lemonade with mint, 500 ml',
        price_cents: 300,
        available_from: '15:00:00',
        available_to: '22:30:00',
        available_weekdays: [1, 2, 3, 4, 5, 6, 7],
        is_post_match_offer: true,
        offer_text: 'Lemonade after your match',
        offer_price_cents: 250,
        photo_path: null,
        dietary_tags: ['vegan', 'gluten-free'],
        active: true,
      },
    ]);
  });

  it('never guesses: unreadable cells are left empty and reported', () => {
    const plan = buildImport(
      input({
        venues: [venueRow({ tue_open: '18:00', tue_close: '01:00', wed_open: '18:00', lockers: 'equipment rental listed' })],
        items: [example, { ...lemonade, price_eur: 'ask', days_available: 'weekends', active: '' }],
      }),
    );
    const [venue] = plan.venues;
    expect(venue.hours.map((h) => h.weekday)).toEqual([1, 6]);
    expect(venue.amenities.map((a) => a.kind)).not.toContain('lockers');
    expect(venue.items[0]).toMatchObject({ price_cents: null, available_weekdays: null, active: false });
    expect(plan.report).toEqual(
      expect.arrayContaining([
        'V001: tue closes after midnight ("01:00"), not supported yet, that day\'s hours skipped',
        'V001: wed has only one of open/close, that day\'s hours skipped',
        'V001: lockers "equipment rental listed" is neither yes nor no, skipped',
        'items row 3: price_eur "ask" unreadable, left empty',
        'items row 3: days_available "weekends" unreadable, left empty',
        'items row 3: active is blank, imported as not active',
      ]),
    );
  });

  it('doesn\'t import the price columns and says so', () => {
    const plan = buildImport(input({ venues: [venueRow({ price_peak_eur_per_hour: '50', price_offpeak_eur_per_hour: '40' })] }));
    expect(JSON.stringify(plan.venues)).not.toMatch(/5000|4000|price_peak|price_offpeak/);
    expect(plan.report).toContain("V001: price columns not imported (peak pricing isn't decided); no price, so it can't be booked");
  });

  it('uses the mapping file to update an existing venue, never matching by name', () => {
    const id = '5f0c3c5e-8d5b-4b8e-9a43-2a4d7c1f0b11';
    const plan = buildImport(input({ mapping: { V001: id } }));
    expect(plan.venues[0].existing_venue_id).toBe(id);
    expect(() => buildImport(input({ mapping: { 'Nuevo Campo': id } }))).toThrow('mapping');
    expect(() => buildImport(input({ mapping: { V001: 'not-a-uuid' } }))).toThrow('mapping');
  });

  it('skips rows without a usable venue_id or name, duplicates, and items for unknown venues', () => {
    const plan = buildImport(
      input({
        venues: [venueRow(), venueRow({ venue_name: 'Again' }), venueRow({ venue_id: 'X9' }), venueRow({ venue_id: 'V002', venue_name: '' })],
        items: [example, lemonade, { ...lemonade }, { ...lemonade, venue_id: 'V404' }],
      }),
    );
    expect(plan.venues.map((v) => v.import_key)).toEqual(['V001']);
    expect(plan.venues[0].items).toHaveLength(1);
    expect(plan.report).toEqual(
      expect.arrayContaining([
        'V001: appears twice, the second row is skipped',
        'X9: not a venue_id (V001...), skipped',
        'V002: no venue_name, skipped',
        'items row 4: V001 already has an item "Lemonade", skipped',
        'items row 5: venue_id "V404" isn\'t an imported venue, skipped',
      ]),
    );
  });

  it('gives the same plan and the same SQL every time (import twice, same data)', () => {
    const at = '2026-11-11T00:00:00.000Z';
    expect(toSql(buildImport(input()).venues, at)).toBe(toSql(buildImport(input()).venues, at));
  });
});

describe('toSql', () => {
  it('imports every venue in one transaction', () => {
    const sql = toSql(buildImport(input()).venues, '2026-11-11T00:00:00.000Z');
    expect(sql.split('\n').filter((l) => l.startsWith('select public.import_venue('))).toHaveLength(1);
    expect(sql).toMatch(/^-- Venue import[\s\S]*\nbegin;\n[\s\S]*\ncommit;\n$/);
    const json = sql.match(/\$venue\$(.*)\$venue\$/)![1];
    expect(JSON.parse(json).import_key).toBe('V001');
  });

  it('refuses a value that would end the SQL string', () => {
    const plan = buildImport(input({ venues: [venueRow({ notes: 'x $venue$ y' })] }));
    expect(() => toSql(plan.venues, 'now')).toThrow('$venue$');
  });
});

describe('uploadPhotos', () => {
  it('uploads each photo once, in order', async () => {
    const { uploads } = buildImport(input({ venues: [venueRow({ photo_permission_given: 'yes' })] }));
    const upload = jest.fn().mockResolvedValue(undefined);
    await expect(uploadPhotos(uploads, upload)).resolves.toBe(3);
    expect(upload.mock.calls.map(([u]) => u.storagePath)).toEqual(['V001/a.jpg', 'V001/b.jpg', 'V001/items/lemonade.jpg']);
  });

  it('uploads nothing for a venue without permission', async () => {
    const upload = jest.fn();
    await expect(uploadPhotos(buildImport(input()).uploads, upload)).resolves.toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it('stops at the first failed upload', async () => {
    const { uploads } = buildImport(input({ venues: [venueRow({ photo_permission_given: 'yes' })] }));
    const upload = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network'));
    await expect(uploadPhotos(uploads, upload)).rejects.toThrow('network');
    expect(upload).toHaveBeenCalledTimes(2);
  });
});

describe('isLocalUrl', () => {
  it('accepts only the local stack', () => {
    expect(isLocalUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalUrl('http://localhost:54321')).toBe(true);
    expect(isLocalUrl('https://abcd.supabase.co')).toBe(false);
    expect(isLocalUrl('not a url')).toBe(false);
  });
});

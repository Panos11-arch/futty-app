import {
  buildImport,
  eurosToCents,
  type ImportInput,
  isLocalUrl,
  parseCsv,
  readAmenity,
  readSpan,
  readWeekdays,
  syncStorage,
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

  it('doesn\'t import the old price columns on the Venues tab and says so (prices come from the Prices tab)', () => {
    const plan = buildImport(input({ venues: [venueRow({ price_peak_eur_per_hour: '50', price_offpeak_eur_per_hour: '40' })] }));
    expect(JSON.stringify(plan.venues)).not.toMatch(/5000|4000|price_peak|price_offpeak/);
    expect(plan.report).toContain('V001: price columns on the Venues tab not imported (prices come from the Prices tab)');
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

describe('syncStorage', () => {
  const storage = (files: Record<string, string[]>) => ({
    list: jest.fn(async (key: string) => files[key] ?? []),
    upload: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  });

  it('withdrawn permission: every file of that venue is deleted from storage, and nothing uploaded', async () => {
    const s = storage({ V001: ['V001/a.jpg', 'V001/b.jpg', 'V001/items/lemonade.jpg'] });
    const result = await syncStorage(buildImport(input()), s);
    expect(s.upload).not.toHaveBeenCalled();
    expect(s.remove).toHaveBeenCalledWith(['V001/a.jpg', 'V001/b.jpg', 'V001/items/lemonade.jpg']);
    expect(result).toEqual({ uploaded: 0, deleted: ['V001/a.jpg', 'V001/b.jpg', 'V001/items/lemonade.jpg'] });
  });

  it('with permission: uploads the sheet\'s photos and deletes only the ones dropped from it', async () => {
    const s = storage({ V001: ['V001/a.jpg', 'V001/old.jpg', 'V001/items/lemonade.jpg', 'V001/items/gone.jpg'] });
    const result = await syncStorage(buildImport(input({ venues: [venueRow({ photo_permission_given: 'yes' })] })), s);
    expect(s.upload).toHaveBeenCalledTimes(3);
    expect(s.remove).toHaveBeenCalledWith(['V001/items/gone.jpg', 'V001/old.jpg']);
    expect(result.uploaded).toBe(3);
  });

  it('nothing to delete: no delete call; venues not in this import are never touched', async () => {
    const s = storage({ V001: [], V002: ['V002/a.jpg'] });
    await syncStorage(buildImport(input()), s);
    expect(s.list).toHaveBeenCalledWith('V001');
    expect(s.list).not.toHaveBeenCalledWith('V002');
    expect(s.remove).not.toHaveBeenCalled();
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


// ---- F8: Pitches, Combinations and Prices tabs, and coordinates ---------------

const pitchRow = (over: Row = {}): Row => ({
  venue_id: 'V001',
  pitch_name: 'Pitch 1',
  size: '5-a-side',
  formats: '5-a-side, 6-a-side',
  surface: 'artificial grass',
  indoor_or_outdoor: 'outdoor',
  confirmed_by_venue: 'yes',
  notes: '',
  ...over,
});
const comboRow = (over: Row = {}): Row => ({
  venue_id: 'V001',
  format: '7-a-side',
  pitch_names: 'Pitch 1 + Pitch 2',
  confirmed_by_venue: 'yes',
  notes: '',
  ...over,
});
const priceRow = (over: Row = {}): Row => ({
  venue_id: 'V001',
  format: '5-a-side',
  price_eur_per_hour: '60.00',
  confirmed_by_venue: 'yes',
  ...over,
});
const twoPitches = [pitchRow(), pitchRow({ pitch_name: 'Pitch 2', formats: '5-a-side' })];

describe('buildImport: pitches (F8)', () => {
  it('imports confirmed pitches exactly as the venue names them', () => {
    const [venue] = buildImport(input({ pitches: twoPitches })).venues;
    expect(venue.pitches).toEqual([
      { name: 'Pitch 1', size: '5-a-side', formats: ['5-a-side', '6-a-side'], surface: 'artificial grass', indoor: false },
      { name: 'Pitch 2', size: '5-a-side', formats: ['5-a-side'], surface: 'artificial grass', indoor: false },
    ]);
  });

  it('skips and reports a pitch the venue hasn\'t confirmed', () => {
    const plan = buildImport(input({ pitches: [pitchRow({ confirmed_by_venue: 'no' }), pitchRow({ pitch_name: 'Pitch 2', confirmed_by_venue: '' })] }));
    expect(plan.venues[0]).not.toHaveProperty('pitches');
    expect(plan.report).toEqual(
      expect.arrayContaining([
        'pitches row 2: V001 "Pitch 1" not confirmed by the venue, skipped',
        'pitches row 3: V001 "Pitch 2" not confirmed by the venue, skipped',
      ])
    );
  });

  it('never guesses: an unreadable size, format list or indoor/outdoor skips the pitch', () => {
    const plan = buildImport(
      input({
        pitches: [
          pitchRow({ size: 'futsal' }),
          pitchRow({ pitch_name: 'Pitch 2', formats: '' }),
          pitchRow({ pitch_name: 'Pitch 3', formats: '5-a-side, 8-a-side' }),
          pitchRow({ pitch_name: 'Pitch 4', indoor_or_outdoor: '' }),
          pitchRow({ pitch_name: 'Pitch 5', indoor_or_outdoor: 'covered' }),
          pitchRow({ venue_id: 'V999', pitch_name: 'Pitch 6' }),
          pitchRow({ pitch_name: '' }),
        ],
      })
    );
    expect(plan.venues[0]).not.toHaveProperty('pitches');
    expect(plan.report).toEqual(
      expect.arrayContaining([
        'pitches row 2: V001 "Pitch 1" size "futsal" isn\'t a format, skipped',
        'pitches row 3: V001 "Pitch 2" has no formats, skipped',
        'pitches row 4: V001 "Pitch 3" formats "5-a-side, 8-a-side" unreadable, skipped',
        'pitches row 5: V001 "Pitch 4" indoor_or_outdoor is blank, skipped',
        'pitches row 6: V001 "Pitch 5" indoor_or_outdoor "covered" isn\'t indoor or outdoor, skipped',
        'pitches row 7: venue_id "V999" isn\'t an imported venue, skipped',
        'pitches row 8: no pitch_name, skipped',
      ])
    );
  });

  it('a pitch named twice: the second row is skipped', () => {
    const plan = buildImport(input({ pitches: [pitchRow(), pitchRow({ surface: 'concrete' })] }));
    expect(plan.venues[0].pitches).toHaveLength(1);
    expect(plan.venues[0].pitches?.[0].surface).toBe('artificial grass');
    expect(plan.report).toContain('pitches row 3: V001 already has a pitch "Pitch 1", skipped');
  });

  it('indoor is read from the sheet; a blank surface stays empty', () => {
    const [venue] = buildImport(input({ pitches: [pitchRow({ indoor_or_outdoor: 'Indoor', surface: '' })] })).venues;
    expect(venue.pitches?.[0]).toMatchObject({ indoor: true, surface: null });
  });

  it('never takes a pitch from the Venues tab\'s free-text columns', () => {
    const plan = buildImport(input({ venues: [venueRow({ pitch_name: 'Big pitch', max_format: '7-a-side' })] }));
    expect(plan.venues[0]).not.toHaveProperty('pitches');
    expect(plan.report).toContain(
      'V001: pitch columns on the Venues tab not imported (pitch_name, max_format); pitches come from the Pitches tab'
    );
  });
});

describe('buildImport: combinations (F8)', () => {
  it('imports a confirmed combination by the exact pitch names', () => {
    const [venue] = buildImport(input({ pitches: twoPitches, combinations: [comboRow()] })).venues;
    expect(venue.combinations).toEqual([{ format: '7-a-side', pitch_names: ['Pitch 1', 'Pitch 2'] }]);
  });

  it('skips and reports one that isn\'t confirmed', () => {
    const plan = buildImport(input({ pitches: twoPitches, combinations: [comboRow({ confirmed_by_venue: 'no' })] }));
    expect(plan.venues[0]).not.toHaveProperty('combinations');
    expect(plan.report).toContain('combinations row 2: V001 7-a-side "Pitch 1 + Pitch 2" not confirmed by the venue, skipped');
  });

  it('refuses a combination naming a pitch the venue doesn\'t have, or too few pitches', () => {
    const plan = buildImport(
      input({
        pitches: twoPitches,
        combinations: [comboRow({ pitch_names: 'Pitch 1 + Pitch 9' }), comboRow({ pitch_names: 'Pitch 1' }), comboRow({ pitch_names: 'Pitch 1 + Pitch 1' })],
      })
    );
    expect(plan.venues[0]).not.toHaveProperty('combinations');
    expect(plan.report).toEqual(
      expect.arrayContaining([
        'combinations row 2: V001 has no pitch "Pitch 9" in the Pitches tab, skipped',
        'combinations row 3: V001 "Pitch 1" needs at least two different pitches joined with "+", skipped',
        'combinations row 4: V001 "Pitch 1 + Pitch 1" needs at least two different pitches joined with "+", skipped',
      ])
    );
  });

  it('refuses one whose pitches can\'t host the format: it must be bigger than every pitch in it', () => {
    const plan = buildImport(
      input({ pitches: twoPitches, combinations: [comboRow({ format: '5-a-side' }), comboRow({ format: '8-a-side' })] })
    );
    expect(plan.venues[0]).not.toHaveProperty('combinations');
    expect(plan.report).toEqual(
      expect.arrayContaining([
        'combinations row 2: V001 "Pitch 1 + Pitch 2" can\'t host 5-a-side (each pitch is already that size or bigger), skipped',
        'combinations row 3: V001 format "8-a-side" isn\'t a format, skipped',
      ])
    );
  });
});

describe('buildImport: prices (F8, one price per format)', () => {
  it('imports a confirmed price per format, in cents from the text', () => {
    const [venue] = buildImport(input({ prices: [priceRow(), priceRow({ format: '7-a-side', price_eur_per_hour: '84,50' })] })).venues;
    expect(venue.prices).toEqual([
      { format: '5-a-side', price_cents: 6000 },
      { format: '7-a-side', price_cents: 8450 },
    ]);
  });

  it('never imports an unconfirmed, blank, unreadable, zero or second price', () => {
    const plan = buildImport(
      input({
        prices: [
          priceRow({ confirmed_by_venue: 'no' }),
          priceRow({ format: '6-a-side', price_eur_per_hour: '' }),
          priceRow({ format: '7-a-side', price_eur_per_hour: 'ask' }),
          priceRow({ format: '9-a-side', price_eur_per_hour: '0' }),
          priceRow({ format: '11-a-side', price_eur_per_hour: '150' }),
          priceRow({ format: '11-a-side', price_eur_per_hour: '160' }),
        ],
      })
    );
    expect(plan.venues[0].prices).toEqual([{ format: '11-a-side', price_cents: 15000 }]);
    expect(plan.report).toEqual(
      expect.arrayContaining([
        'prices row 2: V001 5-a-side not confirmed by the venue, skipped',
        'prices row 3: V001 6-a-side has no price, skipped',
        'prices row 4: V001 7-a-side price "ask" unreadable, skipped',
        'prices row 5: V001 9-a-side price must be above €0, skipped',
        'prices row 7: V001 already has a price for 11-a-side, skipped',
      ])
    );
  });
});

describe('buildImport: coordinates (F8)', () => {
  it('imports a valid pair inside Cyprus', () => {
    const [venue] = buildImport(input({ venues: [venueRow({ latitude: '35.1594', longitude: '33.3501' })] })).venues;
    expect(venue).toMatchObject({ latitude: 35.1594, longitude: 33.3501 });
  });

  it('both or neither, decimal degrees, inside Cyprus: anything else is reported and left empty', () => {
    const plan = buildImport(
      input({
        venues: [
          venueRow({ latitude: '35.1594', longitude: '' }),
          venueRow({ venue_id: 'V002', latitude: '51.5072', longitude: '-0.1276' }),
          venueRow({ venue_id: 'V003', latitude: '35°09′N', longitude: '33°21′E' }),
        ],
      })
    );
    for (const venue of plan.venues) {
      expect(venue).not.toHaveProperty('latitude');
      expect(venue).not.toHaveProperty('longitude');
    }
    expect(plan.report).toEqual(
      expect.arrayContaining([
        'V001: only one of latitude/longitude, coordinates left empty',
        'V002: coordinates 51.5072, -0.1276 aren\'t in Cyprus, left empty',
        'V003: coordinates "35°09′N", "33°21′E" aren\'t decimal degrees, left empty',
      ])
    );
  });

  it('a blank pair stays empty and isn\'t reported (never filled from the address)', () => {
    const plan = buildImport(input());
    expect(plan.venues[0]).not.toHaveProperty('latitude');
    expect(plan.report.join('\n')).not.toMatch(/coordinates|latitude/);
  });
});

describe('buildImport: the same sheet gives the same plan (F8)', () => {
  it('is idempotent', () => {
    const sheet = input({ pitches: twoPitches, combinations: [comboRow()], prices: [priceRow()] });
    expect(buildImport(sheet)).toEqual(buildImport(sheet));
    expect(toSql(buildImport(sheet).venues, 'T')).toEqual(toSql(buildImport(sheet).venues, 'T'));
  });
});

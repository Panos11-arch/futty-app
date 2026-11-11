# Venue data import

Loads the venue sheet (`futsal_venues_cyprus.xlsx`) into the venue tables and photo storage. The rules are in spec 13, "Venue pages and the venue data import". None of the data (the sheet, its CSVs, photos or the generated SQL) goes in this repo.

## 1. Export the two tabs as CSV

Save the **Venues** and **Venue items** tabs as `venues.csv` and `venue_items.csv`, in the folder that holds the sheet. Save as CSV UTF-8 from Excel, or use any one-off converter outside the repo. Row 1 is the header. The import always skips row 2 of Venue items, the example row.

## 2. Photos (optional)

```
futty-app-venue-data/
  photos/
    V001/          venue photos, shown in file-name order (jpg, png or webp)
    items/         food and drink photos, named as in photo_file_name
```

Photos are uploaded only for venues whose `photo_permission_given` is yes. A venue without permission is still imported, with no photos.

## 3. Map existing venues (optional)

If a venue already exists under another id, give its id in a mapping file. Venues are never matched by name.

```json
{ "V001": "5f0c3c5e-8d5b-4b8e-9a43-2a4d7c1f0b11" }
```

## 4. Run it

```
node scripts/import-venues/run.mjs \
  --venues ../futty-app-venue-data/venues.csv \
  --items ../futty-app-venue-data/venue_items.csv \
  --photos ../futty-app-venue-data/photos \
  [--mapping ../futty-app-venue-data/mapping.json]
```

Needs Node 24, which runs `venue-import.ts` directly. Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning about that; it's harmless.

The script:
- prints what it will import and a report of every cell it didn't import, such as a close after midnight, an amenity that's neither yes nor no, or an unreadable price;
- uploads the photos with permission, if there are any. This uses the Storage API at `SUPABASE_URL` (default `http://127.0.0.1:54321`) with `SUPABASE_SERVICE_ROLE_KEY`. It refuses a URL that isn't local unless you pass `--allow-remote`;
- writes `venue-import.sql` next to the CSVs (or to `--out`). The file runs `public.import_venue` for every venue in one transaction.

Then run that SQL. Locally, with only the database running (`npx supabase db start`):

```
docker cp ../futty-app-venue-data/venue-import.sql supabase_db_futty-app:/tmp/venue-import.sql
docker exec supabase_db_futty-app psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/venue-import.sql
```

Running it again gives the same data: venues are keyed on `venue_id` (V001...).

## What it never does

- **Makes a venue live.** A venue it creates is not live, and it never changes `is_live` on an existing venue.
- **Sets a price or a pitch.** The sheet has no named pitches, and `price_peak` / `price_offpeak` aren't used yet. A venue with no price can't be booked.
- **Fills a blank cell.**

Tests: `npx jest scripts/import-venues` (the CSV mapping) and `supabase/tests/pay-venue-pages-1.test.sql` (`import_venue`).

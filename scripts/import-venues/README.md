# Venue data import

Loads the venue sheet (`futsal_venues_cyprus.xlsx`) into the venue tables and photo storage. The rules are in spec 13, "Venue pages and the venue data import". None of the data (the sheet, its CSVs, photos or the generated SQL) goes in this repo.

## 1. Export the tabs as CSV

Save each tab as CSV UTF-8 from Excel (or any one-off converter outside the repo), in the folder that holds the sheet. Row 1 is the header. The import always skips row 2 of Venue items, the example row; the other tabs have no example row.

| Tab | File | Needed |
| :-- | :-- | :-- |
| Venues | `venues.csv` | yes |
| Venue items | `venue_items.csv` | yes |
| Pitches | `pitches.csv` | optional |
| Combinations | `combinations.csv` | optional |
| Prices | `prices.csv` | optional |

### Venues tab: coordinates

Two columns, `latitude` and `longitude`, in decimal degrees (copy them from Google Maps: right-click the pitch, click the numbers). Both or neither, inside Cyprus. Example: `35.1594`, `33.3501`. Anything else is reported and left empty; they're never looked up from the address. The old `price_peak_eur_per_hour`, `price_offpeak_eur_per_hour` and `peak_hours` columns are gone: prices are on the Prices tab.

### Pitches tab (one row per pitch)

| venue_id | pitch_name | size | formats | surface | indoor_or_outdoor | confirmed_by_venue | notes |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| V001 | Pitch 1 | 5-a-side | 5-a-side, 6-a-side | artificial grass | outdoor | yes | |

- `pitch_name` exactly as the venue names it: that's what players see and how a re-import finds the pitch.
- `size` and each of `formats` (the formats it hosts on its own, comma-separated): 5-a-side, 6-a-side, 7-a-side, 9-a-side or 11-a-side.
- `indoor_or_outdoor`: indoor or outdoor.

### Combinations tab (one row per combination)

| venue_id | format | pitch_names | confirmed_by_venue | notes |
| :-- | :-- | :-- | :-- | :-- |
| V001 | 7-a-side | Pitch 1 + Pitch 2 | yes | |

`pitch_names` are exact names from the Pitches tab, joined with "+". The format must be bigger than every pitch in it.

### Prices tab (one price per format)

| venue_id | format | price_eur_per_hour | confirmed_by_venue |
| :-- | :-- | :-- | :-- |
| V001 | 5-a-side | 60.00 | yes |

The venue's one price for that format, the same on every day and at every hour (decided 19 November). Above €0.

**Only rows with `confirmed_by_venue` = yes are imported.** Every other row is skipped and listed in the report.

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
  --pitches ../futty-app-venue-data/pitches.csv \
  --combinations ../futty-app-venue-data/combinations.csv \
  --prices ../futty-app-venue-data/prices.csv \
  --photos ../futty-app-venue-data/photos \
  [--mapping ../futty-app-venue-data/mapping.json]
```

Needs Node 24, which runs `venue-import.ts` directly. Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning about that; it's harmless.

The script:
- prints what it will import and a report of every cell it didn't import, such as a close after midnight, an amenity that's neither yes nor no, or an unreadable price;
- with `SUPABASE_SERVICE_ROLE_KEY` set, brings storage in line through the Storage API at `SUPABASE_URL` (default `http://127.0.0.1:54321`). It uploads the photos that have permission, and deletes every other file in an imported venue's folders: all of them when permission was withdrawn, or a photo dropped from the sheet. It refuses a URL that isn't local unless you pass `--allow-remote`. Without the key, storage isn't touched (this is allowed only when there's nothing to upload) and the script says so. Players can't read a file no photo row points to anyway;
- writes `venue-import.sql` next to the CSVs (or to `--out`). The file runs `public.import_venue` for every venue in one transaction.

Then run that SQL. Locally, with only the database running (`npx supabase db start`):

```
docker cp ../futty-app-venue-data/venue-import.sql supabase_db_futty-app:/tmp/venue-import.sql
docker exec supabase_db_futty-app psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/venue-import.sql
```

Running it again gives the same data: venues are keyed on `venue_id` (V001...), pitches on their exact name at that venue. Running the SQL prints a NOTICE for every pitch it keeps as it is (it holds a game, so its size and formats can't change; or it isn't on the Pitches tab) and every combination it skips: read them.

## What it never does

- **Makes a venue live.** A venue it creates is not live, and it never changes `is_live` on an existing venue.
- **Imports a pitch, combination or price the venue hasn't confirmed,** or works one out from the Venues tab's free text. A venue with no price can't be booked.
- **Deletes a pitch.** A pitch missing from the Pitches tab is reported and kept; a pitch holding a game keeps its size and formats.
- **Looks up coordinates from an address.**
- **Fills a blank cell.**

Tests: `npx jest scripts/import-venues` (the CSV mapping), `supabase/tests/pay-venue-pages-1.test.sql` and `supabase/tests/pay-import-pitches.test.sql` (`import_venue`).

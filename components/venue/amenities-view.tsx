// Amenities (P6e; spec 13 "Venue photos, amenities and menu"; spec 05
// section 12): staff pick from the fixed list and may add a note to each, up
// to 60 characters ("Other" needs one). Saving replaces the venue's list;
// the server checks every rule.
import { useState } from 'react';

import { Banner, Button, Chip, SectionHeader, Text, TextField } from '@/components/ui';
import { ChipRow, SetupFrame } from '@/components/venue/setup-parts';
import { useVenueMedia, type LoadedMedia } from '@/lib/use-venue-media';
import { AMENITY_KINDS, AMENITY_NOTE_MAX, amenityLabel, setVenueAmenities } from '@/lib/venue-media';
import type { AmenityKind } from '@/lib/venue-page';

export function AmenitiesView({ venueId }: { venueId: string }) {
  const { state, write, retry } = useVenueMedia(venueId);
  return (
    <SetupFrame state={state} retry={retry}>
      {(media) => <AmenitiesForm media={media} onSave={(list) => write(setVenueAmenities(venueId, list))} />}
    </SetupFrame>
  );
}

function AmenitiesForm({
  media,
  onSave,
}: {
  media: LoadedMedia;
  onSave: (amenities: { kind: AmenityKind; note: string }[]) => Promise<string | null>;
}) {
  /** The picked kinds and their notes, as typed. */
  const [notes, setNotes] = useState<Partial<Record<AmenityKind, string>>>(() =>
    Object.fromEntries(media.amenities.map((a) => [a.kind, a.note ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'info' | 'danger'; message: string } | null>(null);

  function toggle(kind: AmenityKind) {
    setResult(null);
    setNotes((current) => {
      const next = { ...current };
      if (kind in next) delete next[kind];
      else next[kind] = '';
      return next;
    });
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const picked = AMENITY_KINDS.filter((k) => k in notes).map((kind) => ({ kind, note: notes[kind] ?? '' }));
    const refusal = await onSave(picked);
    setBusy(false);
    setResult(refusal ? { tone: 'danger', message: refusal } : { tone: 'info', message: 'Amenities saved.' });
  }

  return (
    <>
      <SectionHeader title="Amenities" />
      <Text variant="callout" tone="inkMuted">
        Players see these on your venue page. Add a note if it helps, like how many parking spaces.
      </Text>
      <ChipRow>
        {AMENITY_KINDS.map((kind) => (
          <Chip
            key={kind}
            testID={`amenity-${kind}`}
            label={amenityLabel(kind)}
            selected={kind in notes}
            onPress={() => toggle(kind)}
          />
        ))}
      </ChipRow>
      {AMENITY_KINDS.filter((k) => k in notes).map((kind) => (
        <TextField
          key={kind}
          label={`${amenityLabel(kind)} note`}
          helper={kind === 'other' ? 'Say what it is.' : 'Optional.'}
          value={notes[kind] ?? ''}
          maxLength={AMENITY_NOTE_MAX}
          onChangeText={(text) => setNotes((current) => ({ ...current, [kind]: text }))}
        />
      ))}
      {result ? <Banner tone={result.tone} message={result.message} /> : null}
      <Button label="Save amenities" loading={busy} onPress={save} />
    </>
  );
}

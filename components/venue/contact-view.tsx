// The venue's phone and website (S5), behind Call and Website on its page.
// Staff of that venue only; the server checks the caller and both values
// (set_venue_contact). Blank clears a field.
import { useState } from 'react';

import { Banner, Button, SectionHeader, TextField } from '@/components/ui';
import { SetupFrame, type FrameState } from '@/components/venue/setup-parts';
import { saveVenueContact, type VenueContact } from '@/lib/venue-contact';
import { useVenuePage } from '@/lib/use-venue-page';

export function ContactView({ venueId }: { venueId: string }) {
  const { state, reload } = useVenuePage(venueId);
  const frame: FrameState<VenueContact> =
    state.status === 'ready'
      ? { status: 'ready', setup: { phone: state.data.venue.phone, website: state.data.venue.website } }
      : state.status === 'loading'
        ? { status: 'loading' }
        : { status: 'error', message: 'Could not load your venue. Try again.' };
  return (
    <SetupFrame state={frame} retry={reload}>
      {(setup) => <ContactForm initial={setup} onSave={(phone, website) => saveVenueContact(venueId, phone, website)} />}
    </SetupFrame>
  );
}

export function ContactForm({
  initial,
  onSave,
}: {
  initial: VenueContact;
  onSave: (phone: string, website: string) => Promise<{ saved: VenueContact | null; error: string | null }>;
}) {
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [website, setWebsite] = useState(initial.website ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'info' | 'danger'; message: string } | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const { saved, error } = await onSave(phone, website);
    setBusy(false);
    if (saved) {
      setPhone(saved.phone ?? '');
      setWebsite(saved.website ?? '');
      setResult({ tone: 'info', message: 'Saved.' });
    } else {
      setResult({ tone: 'danger', message: error ?? 'Something went wrong. Try again.' });
    }
  }

  return (
    <>
      <SectionHeader title="Contact" />
      <TextField
        testID="venue-contact-phone"
        label="Phone"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <TextField
        testID="venue-contact-website"
        label="Website"
        value={website}
        onChangeText={setWebsite}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {result ? <Banner tone={result.tone} message={result.message} /> : null}
      <Button testID="venue-contact-save" label="Save contact" loading={busy} onPress={save} />
    </>
  );
}

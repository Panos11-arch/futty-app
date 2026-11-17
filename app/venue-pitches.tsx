// The venue dashboard's setup screen for pitches, open or closed, and which combine (P6e).
import { PitchesView } from '@/components/venue/pitches-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenuePitchesScreen() {
  return <VenueScreen title="Pitches">{(venueId) => <PitchesView venueId={venueId} />}</VenueScreen>;
}

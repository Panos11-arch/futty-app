// The venue dashboard's Credits list (P6d): players' credit at the venue, with expiry.
import { CreditsView } from '@/components/venue/credits-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueCreditsScreen() {
  return <VenueScreen title="Credits">{(venueId) => <CreditsView venueId={venueId} />}</VenueScreen>;
}

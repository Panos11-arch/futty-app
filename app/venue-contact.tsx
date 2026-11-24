// The venue dashboard's setup screen for the venue's phone and website (S5).
import { ContactView } from '@/components/venue/contact-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueContactScreen() {
  return <VenueScreen title="Contact">{(venueId) => <ContactView venueId={venueId} />}</VenueScreen>;
}

// The venue dashboard's setup screen for the food and drink menu (P6e).
import { MenuView } from '@/components/venue/menu-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueMenuScreen() {
  return <VenueScreen title="Food and drink">{(venueId) => <MenuView venueId={venueId} />}</VenueScreen>;
}

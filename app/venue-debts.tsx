// The venue dashboard's Debts list (P6d): what players owe the venue, and Mark settled.
import { DebtsView } from '@/components/venue/debts-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueDebtsScreen() {
  return <VenueScreen title="Debts">{(venueId) => <DebtsView venueId={venueId} />}</VenueScreen>;
}

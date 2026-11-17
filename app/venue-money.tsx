// The venue dashboard's Money screen (P6d): revenue by source and the CSV export.
import { MoneyView } from '@/components/venue/money-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueMoneyScreen() {
  return <VenueScreen title="Money">{(venueId) => <MoneyView venueId={venueId} />}</VenueScreen>;
}

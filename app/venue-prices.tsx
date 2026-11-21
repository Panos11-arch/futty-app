// The venue dashboard's setup screen for each format's one price an hour, the same on every day and at every hour (P6e).
import { PricesView } from '@/components/venue/prices-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenuePricesScreen() {
  return <VenueScreen title="Prices">{(venueId) => <PricesView venueId={venueId} />}</VenueScreen>;
}

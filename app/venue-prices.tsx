// The venue dashboard's setup screen for prices an hour per format, with peak and weekend prices (P6e).
import { PricesView } from '@/components/venue/prices-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenuePricesScreen() {
  return <VenueScreen title="Prices">{(venueId) => <PricesView venueId={venueId} />}</VenueScreen>;
}

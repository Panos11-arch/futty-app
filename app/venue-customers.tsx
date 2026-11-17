// The venue dashboard's Customers list (P6d): app players and walk-in or phone contacts.
import { router } from 'expo-router';

import { CustomersView } from '@/components/venue/customers-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueCustomersScreen() {
  return (
    <VenueScreen title="Customers">
      {(venueId) => (
        <CustomersView
          venueId={venueId}
          onOpen={(kind, id) => router.push({ pathname: '/venue-customer', params: { venueId, kind, id } })}
        />
      )}
    </VenueScreen>
  );
}

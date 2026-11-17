// One customer of the venue (P6d): their bookings, debt and credit here.
import { useLocalSearchParams } from 'expo-router';

import { EmptyState } from '@/components/ui';
import { CustomerView } from '@/components/venue/customer-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueCustomerScreen() {
  const { kind, id } = useLocalSearchParams<{ kind?: string; id?: string }>();
  return (
    <VenueScreen title="Customer">
      {(venueId) =>
        (kind === 'player' || kind === 'contact') && id ? (
          <CustomerView venueId={venueId} kind={kind} id={id} />
        ) : (
          <EmptyState icon="person.fill" message="This customer couldn’t be found." />
        )
      }
    </VenueScreen>
  );
}

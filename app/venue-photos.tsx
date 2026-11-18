// The venue dashboard's setup screen for the venue's photos (P6e).
import { PhotosView } from '@/components/venue/photos-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenuePhotosScreen() {
  return <VenueScreen title="Photos">{(venueId) => <PhotosView venueId={venueId} />}</VenueScreen>;
}

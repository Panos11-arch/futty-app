// Venue photos (P6e; spec 13 "Venue photos, amenities and menu"; spec 05
// section 12): staff confirm once that the photos are the venue's own and
// Futty may show them, then add photos (shrunk to 1600 px JPEG and uploaded
// before the server registers them), put them in order and remove them. The
// first is the cover everywhere. The server holds the limit (10) and every
// rule; this screen only hides Add photo at the limit it reports.
import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, Card, EmptyState, SectionHeader, Text } from '@/components/ui';
import { ConfirmStep, SetupFrame } from '@/components/venue/setup-parts';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useVenueMedia } from '@/lib/use-venue-media';
import {
  addVenuePhoto,
  confirmPhotoPermission,
  describeMediaError,
  movePhoto,
  PHOTO_PERMISSION_TEXT,
  pickAndCompressPhoto,
  removeVenuePhoto,
  reorderVenuePhotos,
  type VenuePhoto,
} from '@/lib/venue-media';

export function PhotosView({ venueId }: { venueId: string }) {
  const styles = useStyles();
  const { state, write, retry } = useVenueMedia(venueId);
  /** 'add', 'permission', or the id of the photo being changed. */
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<string | null>) {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    const refusal = await action();
    setBusy(null);
    if (refusal) setNotice(refusal);
  }

  function add() {
    return run('add', async () => {
      let uri: string | null;
      try {
        uri = await pickAndCompressPhoto();
      } catch {
        return describeMediaError('picker_failed');
      }
      return uri ? write(addVenuePhoto(venueId, uri)) : null;
    });
  }

  function reorder(photos: VenuePhoto[], id: string, move: 'earlier' | 'later' | 'cover') {
    const ids = photos.map((p) => p.id);
    return run(id, () => write(reorderVenuePhotos(venueId, movePhoto(ids, id, move))));
  }

  function remove(id: string) {
    return run(id, async () => {
      const refusal = await write(removeVenuePhoto(id));
      if (!refusal) setConfirming(null);
      return refusal;
    });
  }

  return (
    <SetupFrame state={state} retry={retry}>
      {(media) => {
        const count = media.photos.length;
        const full = count >= media.max_photos;
        return (
          <>
            <SectionHeader title="Photos" />
            <Text variant="callout" tone="inkMuted">
              The first photo is the cover on Book, Home, bookings and your venue page.
            </Text>

            {media.photo_permission === null ? (
              <Card testID="photo-permission">
                <View style={styles.stack}>
                  <Text variant="headline">Before you add photos</Text>
                  <Text variant="body">{PHOTO_PERMISSION_TEXT}</Text>
                  <Button
                    label="Confirm"
                    loading={busy === 'permission'}
                    onPress={() => run('permission', () => write(confirmPhotoPermission(venueId)))}
                  />
                </View>
              </Card>
            ) : (
              <>
                <Text variant="callout" tabular>{`${count} of ${media.max_photos} photos`}</Text>
                {full ? (
                  <Banner tone="info" message="You have the most photos a venue can have. Remove one to add another." />
                ) : (
                  <Button label="Add photo" loading={busy === 'add'} disabled={busy !== null} onPress={add} />
                )}
              </>
            )}

            {notice ? <Banner tone="danger" message={notice} /> : null}
            {count === 0 ? <EmptyState icon="photo" message="No photos yet." /> : null}

            {media.photos.map((photo, i) => {
              const url = media.photoUrls[photo.storage_path];
              const label = i === 0 ? 'Cover' : `Photo ${i + 1}`;
              return (
                <Card key={photo.id} padded={false} testID={`photo-${photo.id}`}>
                  {url ? (
                    <Image
                      testID="venue-photo-image"
                      source={{ uri: url }}
                      contentFit="cover"
                      accessibilityLabel={label}
                      style={styles.photo}
                    />
                  ) : (
                    <View style={[styles.photo, styles.missing]}>
                      <Text variant="caption" tone="inkMuted">
                        This photo can’t be shown.
                      </Text>
                    </View>
                  )}
                  <View style={styles.body}>
                    <Text variant="headline">{label}</Text>
                    {confirming === photo.id ? (
                      <ConfirmStep
                        message="Players won’t see this photo any more."
                        confirmLabel="Remove photo"
                        busy={busy === photo.id}
                        onConfirm={() => remove(photo.id)}
                        onBack={() => setConfirming(null)}
                      />
                    ) : (
                      <View style={styles.actions}>
                        {i > 0 ? (
                          <Button
                            testID={`photo-cover-${photo.id}`}
                            label="Make cover"
                            variant="secondary"
                            disabled={busy !== null}
                            onPress={() => reorder(media.photos, photo.id, 'cover')}
                          />
                        ) : null}
                        {i > 1 ? (
                          <Button
                            testID={`photo-earlier-${photo.id}`}
                            label="Move earlier"
                            variant="plain"
                            disabled={busy !== null}
                            onPress={() => reorder(media.photos, photo.id, 'earlier')}
                          />
                        ) : null}
                        {i < count - 1 ? (
                          <Button
                            testID={`photo-later-${photo.id}`}
                            label="Move later"
                            variant="plain"
                            disabled={busy !== null}
                            onPress={() => reorder(media.photos, photo.id, 'later')}
                          />
                        ) : null}
                        <Button
                          testID={`photo-remove-${photo.id}`}
                          label="Remove"
                          variant="plain"
                          disabled={busy !== null}
                          onPress={() => setConfirming(photo.id)}
                        />
                      </View>
                    )}
                  </View>
                </Card>
              );
            })}
          </>
        );
      }}
    </SetupFrame>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  stack: { gap: space.md },
  photo: { width: '100%', aspectRatio: 4 / 3, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  missing: { backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.lg, gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));

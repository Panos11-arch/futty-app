// The food and drink menu (P6e; spec 13 "Venue photos, amenities and menu";
// spec 05 section 12): every item, switched off ones too, by category and
// then the staff's order, as the server sends them. Tap one to edit it, give
// it a photo, move it, switch it off or delete it. Players see the items
// that are on under "Food and drink" on the venue page.
import { useState } from 'react';
import { View } from 'react-native';

import { EmptyState, ListRow, SectionHeader, Text } from '@/components/ui';
import { MenuItemSheet } from '@/components/venue/menu-item-sheet';
import { SetupFrame } from '@/components/venue/setup-parts';
import { formatEuros } from '@/lib/money/format';
import { useVenueMedia } from '@/lib/use-venue-media';
import {
  deleteMenuItem,
  describeMediaError,
  groupMenu,
  moveMenuItem,
  pickAndCompressPhoto,
  removeMenuItemPhoto,
  reorderMenuItems,
  saveMenuItem,
  setMenuItemActive,
  setMenuItemPhoto,
  type MenuItem,
} from '@/lib/venue-media';
import { offerWhen } from '@/lib/venue-page';

/** The server's prices, unchanged: "€4.00 · post-match offer €3.00 · Mon–Fri, 17:00–23:00". */
function itemLine(item: MenuItem): string {
  const parts = [
    item.active ? null : 'Switched off',
    item.price_cents !== null ? formatEuros(item.price_cents) : 'No price',
    item.is_post_match_offer
      ? item.offer_price_cents !== null
        ? `post-match offer ${formatEuros(item.offer_price_cents)}`
        : 'post-match offer'
      : null,
    offerWhen(item),
  ];
  return parts.filter(Boolean).join(' · ');
}

export function MenuView({ venueId }: { venueId: string }) {
  const { state, write, retry } = useVenueMedia(venueId);
  /** The item open in the sheet: 'new' to add one. */
  const [editing, setEditing] = useState<string | null>(null);

  async function addPhoto(itemId: string): Promise<string | null> {
    let uri: string | null;
    try {
      uri = await pickAndCompressPhoto();
    } catch {
      return describeMediaError('picker_failed');
    }
    return uri ? write(setMenuItemPhoto(venueId, itemId, uri)) : null;
  }

  return (
    <SetupFrame state={state} retry={retry}>
      {(media) => {
        const item = editing && editing !== 'new' ? (media.items.find((i) => i.id === editing) ?? null) : null;
        const groups = groupMenu(media.items);
        return (
          <>
            <SectionHeader
              title="Food and drink"
              action={{ label: 'Add item', onPress: () => setEditing('new') }}
            />
            <Text variant="callout" tone="inkMuted">
              Players see the items that are on under Food and drink on your venue page.
            </Text>
            {media.items.length === 0 ? (
              <EmptyState icon="cup.and.saucer.fill" message="No items yet. Add your first item." />
            ) : null}

            {groups.map((group) => (
              <View key={group.title ?? 'items'} testID={`menu-group-${group.title ?? 'items'}`}>
                {group.title ? <SectionHeader title={group.title} /> : null}
                {group.items.map((i) => (
                  <ListRow
                    key={i.id}
                    testID={`item-${i.id}`}
                    title={i.name}
                    subtitle={itemLine(i)}
                    leading={{ icon: 'cup.and.saucer.fill' }}
                    chevron
                    onPress={() => setEditing(i.id)}
                  />
                ))}
              </View>
            ))}

            {editing !== null && (editing === 'new' || item) ? (
              <MenuItemSheet
                key={editing}
                item={item}
                photoUrl={item?.photo_path ? media.photoUrls[item.photo_path] : undefined}
                canAddPhoto={media.photo_permission !== null}
                canMoveUp={item ? moveMenuItem(media.items, item.id, 'up') !== null : false}
                canMoveDown={item ? moveMenuItem(media.items, item.id, 'down') !== null : false}
                onClose={() => setEditing(null)}
                onSave={(input) => write(saveMenuItem(venueId, item?.id ?? null, input))}
                onMove={async (move) => {
                  const ids = moveMenuItem(media.items, item!.id, move);
                  return ids ? write(reorderMenuItems(venueId, ids)) : null;
                }}
                onSetActive={(active) => write(setMenuItemActive(item!.id, active))}
                onAddPhoto={() => addPhoto(item!.id)}
                onRemovePhoto={() => write(removeMenuItemPhoto(item!.id))}
                onDelete={() => write(deleteMenuItem(item!.id))}
              />
            ) : null}
          </>
        );
      }}
    </SetupFrame>
  );
}

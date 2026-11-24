// The Amenities chip's sheet (S5A): café or bar, restaurant, parking,
// showers and changing rooms. The server keeps only venues with every one
// ticked (book_search p_amenities).
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { ChoiceRow } from '@/components/booking/book-search/choice-row';
import { Button, Sheet } from '@/components/ui';
import { AMENITY_FILTERS } from '@/lib/booking-search';
import { AMENITIES, type AmenityKind } from '@/lib/venue-page';

export type AmenitiesSheetProps = {
  visible: boolean;
  onClose: () => void;
  value: AmenityKind[];
  onApply: (amenities: AmenityKind[]) => void;
};

export function AmenitiesSheet({ visible, onClose, value, onApply }: AmenitiesSheetProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (visible) setDraft(value);
    // Start again from the search each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Amenities"
      primaryAction={{
        label: 'See results',
        testID: 'book-amenities-see-results',
        // In the filter's own order, whatever order they were ticked in.
        onPress: () => onApply(AMENITY_FILTERS.filter((k) => draft.includes(k))),
      }}>
      <View>
        <Button testID="book-amenities-clear" label="Clear" variant="plain" size="compact" onPress={() => setDraft([])} />
      </View>
      {AMENITY_FILTERS.map((kind) => {
        const on = draft.includes(kind);
        return (
          <ChoiceRow
            key={kind}
            testID={`book-amenity-${kind}`}
            kind="checkbox"
            title={AMENITIES[kind].label}
            checked={on}
            onPress={() => setDraft(on ? draft.filter((k) => k !== kind) : [...draft, kind])}
          />
        );
      })}
    </Sheet>
  );
}

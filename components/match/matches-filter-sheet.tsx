import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import type { MatchesFilter } from '@/lib/match/day-fixtures';
import { LEAGUE_FORMATS } from '@/lib/match/league-directory';
import { makeStyles } from '@/lib/theme';

export type MatchesFilterSheetProps = {
  visible: boolean;
  value: MatchesFilter;
  /** Cities that have a league: { scope (normalised), label }. */
  cities: { scope: string; label: string }[];
  onApply: (filter: MatchesFilter) => void;
  onClose: () => void;
};

/** Format and city for the MATCHES tab. */
export function MatchesFilterSheet({ visible, value, cities, onApply, onClose }: MatchesFilterSheetProps) {
  const styles = useStyles();
  const [draft, setDraft] = useState<MatchesFilter>(value);
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filter"
      primaryAction={{ label: 'Show matches', onPress: () => onApply(draft), testID: 'matches-filter-apply' }}
      secondaryAction={{ label: 'Clear', onPress: () => onApply({ format: null, scope: null }), testID: 'matches-filter-clear' }}>
      <View style={styles.block}>
        <Text variant="headline">Format</Text>
        <View style={styles.chips}>
          <Chip label="All" selected={draft.format === null} onPress={() => setDraft({ ...draft, format: null })} testID="matches-filter-format-all" />
          {LEAGUE_FORMATS.map((format) => (
            <Chip
              key={format}
              label={format}
              selected={draft.format === format}
              onPress={() => setDraft({ ...draft, format })}
              testID={`matches-filter-format-${format}`}
            />
          ))}
        </View>
      </View>
      {cities.length > 0 ? (
        <View style={styles.block}>
          <Text variant="headline">City</Text>
          <View style={styles.chips}>
            <Chip label="All" selected={draft.scope === null} onPress={() => setDraft({ ...draft, scope: null })} testID="matches-filter-city-all" />
            {cities.map((city) => (
              <Chip
                key={city.scope}
                label={city.label}
                selected={draft.scope === city.scope}
                onPress={() => setDraft({ ...draft, scope: city.scope })}
                testID={`matches-filter-city-${city.scope}`}
              />
            ))}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  block: { gap: space.sm, paddingBottom: space.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));

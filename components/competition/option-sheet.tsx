// A bottom sheet with one choice per row (season, round, team, matchday),
// and a search field when the list is long (teams).
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ICON } from '@/components/ui/foundation';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

export type SheetOption = { key: string; label: string };

export function OptionSheet({
  visible,
  onClose,
  title,
  options,
  selectedKey,
  onSelect,
  search = false,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: SheetOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  search?: boolean;
  testID: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {search ? (
        <TextField
          label="Search"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          testID={`${testID}-search`}
          accessibilityLabel={`Search ${title.toLowerCase()}`}
        />
      ) : null}
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" testID={testID}>
        {shown.length === 0 ? (
          <Text variant="callout" tone="inkMuted" style={styles.empty}>
            Nothing found.
          </Text>
        ) : (
          shown.map((o) => {
            const selected = o.key === selectedKey;
            return (
              <ListRow
                key={o.key}
                testID={`${testID}-${o.key}`}
                title={o.label}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                trailing={selected ? <IconSymbol name="checkmark" size={ICON.small} color={colors.ink} /> : undefined}
                onPress={() => {
                  onSelect(o.key);
                  onClose();
                }}
              />
            );
          })
        )}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: space.xxl * 10 },
  empty: { paddingVertical: space.md },
}));

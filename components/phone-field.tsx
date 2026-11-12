import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { PopupModal } from '@/components/popup-modal';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { colors, radius, space, type } from '@/constants/futty-theme';
import { COUNTRIES, type Country } from '@/lib/countries';

/** Dial-code picker + national number field, replacing a plain free-text
 *  phone input — tapping the code pill opens a country list; the number
 *  typed next to it is always just the national number, never the code.
 *  Countries show as their two-letter code, not a flag (no emoji in the UI). */
export function PhoneField({
  country,
  national,
  onChangeCountry,
  onChangeNational,
}: {
  country: Country;
  national: string;
  onChangeCountry: (country: Country) => void;
  onChangeNational: (national: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Country code, ${country.name} ${country.dialCode}`}
        onPress={() => setPickerOpen(true)}
        style={styles.codePill}>
        <Text variant="body" tabular>
          {country.iso2} {country.dialCode}
        </Text>
        <IconSymbol name="chevron.down" size={20} color={colors.inkMuted} />
      </Pressable>

      <TextInput
        accessibilityLabel="Phone number"
        value={national}
        onChangeText={onChangeNational}
        placeholder="99 123456"
        placeholderTextColor={colors.inkMuted}
        keyboardType="phone-pad"
        style={styles.input}
      />

      <PopupModal visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Select country">
        <FlatList
          data={COUNTRIES}
          keyExtractor={(item) => item.iso2}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name} ${item.dialCode}`}
              accessibilityState={{ selected: item.iso2 === country.iso2 }}
              onPress={() => {
                onChangeCountry(item);
                setPickerOpen(false);
              }}
              style={[styles.countryRow, item.iso2 === country.iso2 && styles.countryRowSelected]}>
              <Text variant="body" style={styles.countryName}>
                {item.name}
              </Text>
              <Text variant="callout" tone="inkMuted" tabular>
                {item.dialCode}
              </Text>
            </Pressable>
          )}
        />
      </PopupModal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  codePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: MIN_TOUCH,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
  },
  input: {
    ...type.body,
    flex: 1,
    color: colors.ink,
    minHeight: MIN_TOUCH,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  countryRowSelected: { backgroundColor: colors.brandSoft },
  countryName: { flex: 1 },
});

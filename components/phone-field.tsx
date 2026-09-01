import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { PopupModal } from '@/components/popup-modal';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { COUNTRIES, type Country } from '@/lib/countries';

/** Dial-code picker + national number field, replacing a plain free-text
 *  phone input — tapping the flag/code pill opens a country list; the number
 *  typed next to it is always just the national number, never the code. */
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
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const textColor = useThemeColor({}, 'text');

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setPickerOpen(true)}
        style={[styles.codePill, { borderColor: border }]}>
        <ThemedText style={styles.flag}>{country.flag}</ThemedText>
        <ThemedText style={styles.codeText}>{country.dialCode}</ThemedText>
        <IconSymbol name="chevron.down" size={14} color={FuttyColors.stone500} />
      </Pressable>

      <TextInput
        value={national}
        onChangeText={onChangeNational}
        placeholder="99 123456"
        placeholderTextColor={border}
        keyboardType="phone-pad"
        style={[styles.input, { borderColor: border, color: textColor }]}
      />

      <PopupModal visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Select country">
        <FlatList
          data={COUNTRIES}
          keyExtractor={(item) => item.iso2}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onChangeCountry(item);
                setPickerOpen(false);
              }}
              style={[styles.countryRow, item.iso2 === country.iso2 && styles.countryRowSelected]}>
              <ThemedText style={styles.flag}>{item.flag}</ThemedText>
              <ThemedText style={styles.countryName}>{item.name}</ThemedText>
              <ThemedText style={styles.countryDial}>{item.dialCode}</ThemedText>
            </Pressable>
          )}
        />
      </PopupModal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  codePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 16,
    paddingHorizontal: 12,
  },
  flag: {
    fontSize: 18,
  },
  codeText: {
    fontSize: 15,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: FuttyColors.stone200,
  },
  countryRowSelected: {
    backgroundColor: FuttyColors.stone50,
  },
  countryName: {
    flex: 1,
    fontSize: 15,
  },
  countryDial: {
    fontSize: 14,
    color: FuttyColors.stone500,
  },
});

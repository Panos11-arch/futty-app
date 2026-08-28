import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={styles.modalFlex} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <ThemedText type="defaultSemiBold">Select country</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setPickerOpen(false)}
              hitSlop={10}
              style={styles.modalClose}>
              <IconSymbol name="xmark" size={18} color={FuttyColors.stone700} />
            </Pressable>
          </View>
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
        </SafeAreaView>
      </Modal>
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
  modalFlex: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: FuttyColors.stone200,
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FuttyColors.stone50,
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

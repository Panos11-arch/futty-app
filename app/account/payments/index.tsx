import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuRow, MenuSection } from '@/components/menu-row';

export default function PaymentsScreen() {
  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MenuSection>
          <MenuRow
            icon="creditcard.fill"
            label="Payment methods"
            onPress={() => router.push('/account/payments/methods')}
          />
          <MenuRow
            icon="exclamationmark.circle.fill"
            label="Debt and credit"
            onPress={() => router.push('/account/payments/owed')}
          />
          <MenuRow
            icon="doc.text.fill"
            label="All transactions"
            onPress={() => router.push('/account/payments/transactions')}
          />
        </MenuSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 16,
    padding: 16,
  },
});

import { router } from 'expo-router';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuRow, MenuSection } from '@/components/menu-row';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

export default function PaymentsScreen() {
  const styles = useStyles();
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

const useStyles = makeStyles(({ colors }) => ({
  flex: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    gap: space.xl,
    padding: space.lg,
  },
}));

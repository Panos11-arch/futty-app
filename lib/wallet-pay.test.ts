import { APPLE_PAY_MERCHANT_ID } from './wallet-pay';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const appJson = require('../app.json');

describe('Apple Pay merchant ID', () => {
  it('is the one registered in the Apple Developer portal', () => {
    expect(APPLE_PAY_MERCHANT_ID).toBe('merchant.com.futty.app');
  });

  it('matches the Stripe plugin in app.json', () => {
    const stripePlugin = appJson.expo.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === '@stripe/stripe-react-native',
    );
    expect(stripePlugin?.[1]?.merchantIdentifier).toBe(APPLE_PAY_MERCHANT_ID);
  });
});

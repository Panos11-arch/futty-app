// Google AdMob (S16), for G4. Nothing calls this yet: there are no ads in
// the app until G4, and G4 also checks the server's ads_allowed (P1: none
// on Premium Plus) before showing one.
//
// Before any ad, Google's consent form (UMP) is gathered: it shows only
// where the law needs it (the EU) and only when the player hasn't answered
// yet. Ads are requested non-personalised only, so App Tracking
// Transparency isn't asked for and app.json has no tracking text; if Futty
// ever shows personalised ads, that changes (with Panos's decision).
//
// The app IDs in app.json are Google's public TEST IDs until Panos sets the
// real ones (an invalid ID crashes the app at launch).
import mobileAds, { AdsConsent } from 'react-native-google-mobile-ads';

/** Every ad request is non-personalised. */
export const AD_REQUEST_OPTIONS = { requestNonPersonalizedAdsOnly: true } as const;

/** Gathers consent, then starts the SDK when ads may be requested. Never throws. */
export async function prepareAds(): Promise<{ canRequestAds: boolean }> {
  try {
    await AdsConsent.gatherConsent();
  } catch {
    // Offline or the form failed: Google advises using any consent already given.
  }
  try {
    const { canRequestAds } = await AdsConsent.getConsentInfo();
    if (!canRequestAds) return { canRequestAds: false };
    await mobileAds().initialize();
    return { canRequestAds: true };
  } catch {
    return { canRequestAds: false };
  }
}

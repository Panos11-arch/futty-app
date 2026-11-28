// The weather strip (P11; docs/specs/13-payments-bookings.md "Forecast for
// players", 15 Design section 5): rain, wind and temperature for the match
// hours on the venue page, checkout and booking detail. When the server says
// app_rules thresholds are met, a banner names them ("Strong wind forecast.",
// several on one line if several) then "The venue may cancel this booking."
// It only warns. Beyond the forecast's range,
// "Forecast available closer to the date".
//
// Apple's attribution rules: wherever its forecast is shown, its "Weather"
// mark and the legal data-sources link are shown too (AppleWeatherMark). A
// forecast without them is not shown.
import { Image } from 'expo-image';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Banner, Card, SectionHeader, SkeletonText, Text } from '@/components/ui';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { space } from '@/constants/futty-theme';
import {
  bannerText,
  detailLine,
  type GameWeather,
  headline,
  OUT_OF_RANGE_TEXT,
  type WeatherAttribution,
} from '@/lib/weather';

export type WeatherStripProps = {
  /** What venue-weather returned for the game's hours; null before it has. */
  weather: GameWeather | null;
  loading?: boolean;
  /** A heading over the card: the venue Home tab's "Weather". The Book tab has none (image 03). */
  title?: string;
};

// S17 (image 03): one card, "22° · Clear at 20:00", then rain and wind on a
// second line (spec 13 shows rain, wind and temperature), then Apple's mark.
export function WeatherStrip({ weather, loading = false, title }: WeatherStripProps) {
  if (!weather) {
    return loading ? (
      <View style={styles.section} testID="weather-strip-loading">
        <SkeletonText lines={2} />
      </View>
    ) : null;
  }
  const { window, attribution } = weather;

  if (window.status === 'out_of_range') {
    return (
      <View style={styles.section} testID="weather-strip">
        {title ? <SectionHeader title={title} /> : null}
        <Card>
          <Text variant="callout" tone="inkMuted">
            {OUT_OF_RANGE_TEXT}
          </Text>
        </Card>
      </View>
    );
  }
  if (window.status !== 'forecast' || !attribution) return null;

  const { forecast } = window;
  const banner = bannerText(forecast);
  const first = headline(forecast, window.start);
  const second = detailLine(forecast);
  return (
    <View style={styles.section} testID="weather-strip">
      {title ? <SectionHeader title={title} /> : null}
      {banner ? <Banner tone="warning" message={banner} /> : null}
      <Card>
        <View style={styles.lines} accessible accessibilityLabel={`${first}. ${second}`}>
          <Text variant="headline" tabular>
            {first}
          </Text>
          <Text variant="callout" tone="inkMuted" tabular>
            {second}
          </Text>
        </View>
        <AppleWeatherMark attribution={attribution} />
      </Card>
    </View>
  );
}

/** Apple's "Weather" mark and the data-sources link, required next to its data. */
export function AppleWeatherMark({ attribution }: { attribution: WeatherAttribution }) {
  return (
    <View style={styles.mark}>
      <Image
        source={{ uri: attribution.logoLight }}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel={attribution.serviceName}
        accessible
      />
      <Pressable
        accessibilityRole="link"
        hitSlop={space.sm}
        onPress={() => Linking.openURL(attribution.legalPageUrl)}
        style={styles.link}
      >
        <Text variant="caption" tone="brand">
          Data sources
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  lines: { gap: space.xs },
  mark: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md },
  // Apple's mark at a legible size (its artwork is about 5:1).
  logo: { height: space.lg, width: space.lg * 5 },
  /** The caption link is short; keep its touch target at 44 (15, section 6). */
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
});

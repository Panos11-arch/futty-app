import { StyleSheet, View } from 'react-native';

import { FuttyColors } from '@/constants/futty-theme';

const STRIPE_COUNT = 9;
const PITCH_GREEN_A = '#1f8a4c';
const PITCH_GREEN_B = '#1c7d45';
const LINE_COLOR = 'rgba(255,255,255,0.55)';

/**
 * Full-bleed top-down football pitch, drawn from plain Views rather than a
 * sourced image (item 3) — no image-asset pipeline exists in this app yet
 * (see premium-plan.tsx's same placeholder-backdrop note), and a drawn pitch
 * scales to any screen size/density for free. Mown-grass stripes + halfway
 * line + center circle + both penalty boxes; a dark scrim on top keeps
 * whatever content sits over it legible.
 */
export function PitchBackground() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <View style={styles.stripes}>
        {Array.from({ length: STRIPE_COUNT }, (_, i) => (
          <View key={i} style={[styles.stripe, { backgroundColor: i % 2 === 0 ? PITCH_GREEN_A : PITCH_GREEN_B }]} />
        ))}
      </View>

      <View style={styles.halfwayLine} />
      <View style={styles.centerCircle} />
      <View style={styles.centerSpot} />

      <View style={[styles.penaltyBox, styles.penaltyBoxTop]} />
      <View style={[styles.goalBox, styles.goalBoxTop]} />
      <View style={[styles.penaltyBox, styles.penaltyBoxBottom]} />
      <View style={[styles.goalBox, styles.goalBoxBottom]} />

      <View style={styles.scrim} />
    </View>
  );
}

const styles = StyleSheet.create({
  stripes: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  stripe: {
    flex: 1,
  },
  halfwayLine: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: LINE_COLOR,
  },
  centerCircle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 140,
    height: 140,
    marginLeft: -70,
    marginTop: -70,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: LINE_COLOR,
  },
  centerSpot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 6,
    height: 6,
    marginLeft: -3,
    marginTop: -3,
    borderRadius: 3,
    backgroundColor: LINE_COLOR,
  },
  penaltyBox: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    height: '16%',
    borderWidth: 2,
    borderColor: LINE_COLOR,
  },
  penaltyBoxTop: {
    top: 0,
    borderTopWidth: 0,
  },
  penaltyBoxBottom: {
    bottom: 0,
    borderBottomWidth: 0,
  },
  goalBox: {
    position: 'absolute',
    left: '36%',
    right: '36%',
    height: '7%',
    borderWidth: 2,
    borderColor: LINE_COLOR,
  },
  goalBoxTop: {
    top: 0,
    borderTopWidth: 0,
  },
  goalBoxBottom: {
    bottom: 0,
    borderBottomWidth: 0,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    // Dark enough that white/amber text and buttons read clearly against it
    // in every lighting condition — matching the Premium popup's flat dark
    // backdrop for contrast, while still leaving the pitch pattern visible
    // underneath as texture rather than a busy, competing photo.
    backgroundColor: '#06210f',
    opacity: 0.72,
  },
});

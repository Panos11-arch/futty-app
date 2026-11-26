// Home's rotating banner (spec 15 section 0.6, image 01): Team of the Week →
// Profile → Leagues → Go Premium, one slide every 5 seconds, swipeable, each
// opening its screen. It never moves by itself while: Reduce motion is on,
// Home isn't on screen, the app isn't in front, a screen reader is on
// (moving content is hard to use with VoiceOver or TalkBack), or a finger
// is on it.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  View,
} from 'react-native';

import { Card } from '@/components/ui/card';
import { useReduceMotion } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { BANNER_ROTATE_MS, type BannerSlide, bannerSlides, nextSlide } from '@/lib/home-banner';
import { isPremiumPlayer } from '@/lib/premium';
import { makeStyles, useTheme } from '@/lib/theme';
import { useProfile } from '@/lib/use-profile';

function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => mounted && setOn(value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setOn);
    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);
  return on;
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

function useOnScreen(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  return focused;
}

/** Whether the banner may move by itself right now. */
export function useBannerCanRotate(): boolean {
  const reduceMotion = useReduceMotion();
  const screenReader = useScreenReader();
  const appActive = useAppActive();
  const onScreen = useOnScreen();
  return !reduceMotion && !screenReader && appActive && onScreen;
}

function Slide({ slide, width }: { slide: BannerSlide; width: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={{ width }}>
      <Card
        testID={`home-banner-${slide.id}`}
        onPress={() => router.push(slide.href)}
        accessibilityLabel={slide.title}
      >
        <View style={styles.slideRow}>
          <View style={styles.tile}>
            <IconSymbol name={slide.icon} size={space.xl} color={colors.green} />
          </View>
          <Text variant="headline" style={styles.slideTitle} numberOfLines={2}>
            {slide.title}
          </Text>
          <IconSymbol name="chevron.right" size={space.lg + space.xs} color={colors.muted} />
        </View>
      </Card>
    </View>
  );
}

export function HomeBanner() {
  const styles = useStyles();
  const profile = useProfile();
  const slides = bannerSlides(isPremiumPlayer(profile));
  const canRotate = useBannerCanRotate();
  const reduceMotion = useReduceMotion();
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<FlatList<BannerSlide>>(null);
  const count = slides.length;
  const current = Math.min(index, count - 1);

  // The timer restarts after every change, so a swipe gets a full 5 seconds.
  useEffect(() => {
    if (!canRotate || dragging || count < 2) return;
    const timer = setTimeout(() => setIndex((i) => nextSlide(i, count)), BANNER_ROTATE_MS);
    return () => clearTimeout(timer);
  }, [canRotate, dragging, count, current]);

  useEffect(() => {
    if (width > 0) listRef.current?.scrollToOffset({ offset: current * width, animated: !reduceMotion });
  }, [current, width, reduceMotion]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onSwipeEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setDragging(false);
    if (width > 0) setIndex(Math.max(0, Math.min(count - 1, Math.round(e.nativeEvent.contentOffset.x / width))));
  };

  return (
    <View testID="home-banner" style={styles.banner}>
      <FlatList
        ref={listRef}
        testID="home-banner-list"
        horizontal
        pagingEnabled
        data={slides}
        keyExtractor={(slide) => slide.id}
        renderItem={({ item }) => <Slide slide={item} width={width} />}
        onLayout={onLayout}
        onScrollBeginDrag={() => setDragging(true)}
        onMomentumScrollEnd={onSwipeEnd}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />
      <View style={styles.dots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {slides.map((slide, i) => (
          <View
            key={slide.id}
            testID={`home-banner-dot-${i}`}
            accessibilityState={{ selected: i === current }}
            style={[styles.dot, i === current && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  banner: { gap: space.md },
  slideRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tile: {
    width: space.xxl + space.lg,
    height: space.xxl + space.lg,
    borderRadius: radius.control,
    backgroundColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideTitle: { flex: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.xs + space.xs / 2 },
  dot: { width: space.sm, height: space.sm, borderRadius: radius.pill, backgroundColor: colors.border },
  dotActive: { width: space.xl, backgroundColor: colors.ink },
}));

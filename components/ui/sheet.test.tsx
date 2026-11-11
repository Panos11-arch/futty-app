import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, Text } from 'react-native';

import { Sheet, shouldCloseOnSwipe } from '@/components/ui/sheet';
import { loadWithFile } from '@/components/ui/test-utils';

// On a cold cache (CI) the first render here used to take longer than the
// 5 s timeout: Modal (~10 s to load) and React Native's renderer, pulled in
// by the sheet's Animated.View (~5 s). Load them with the file instead. The
// slide-up itself costs no real time: beforeEach turns on fake timers.
loadWithFile(Modal, Sheet);

// Draw icons as plain Views (see iconSymbolMock): the native SymbolView's first render costs ~5 s cold.
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));

/** A responder event carrying the touch history PanResponder reads. */
function touch(history: ReturnType<typeof newHistory>, y: number, t: number) {
  const record = history.touchBank[0];
  record.previousPageY = record.currentPageY;
  record.previousTimeStamp = record.currentTimeStamp;
  record.currentPageY = y;
  record.currentTimeStamp = t;
  history.mostRecentTimeStamp = t;
  return {
    nativeEvent: { touches: [{ pageX: 0, pageY: y }], changedTouches: [], pageX: 0, pageY: y, timestamp: t },
    touchHistory: history,
  };
}

function newHistory() {
  return {
    numberActiveTouches: 1,
    indexOfSingleActiveTouch: 0,
    mostRecentTimeStamp: 0,
    touchBank: [
      {
        touchActive: true,
        startPageX: 0,
        startPageY: 0,
        startTimeStamp: 0,
        currentPageX: 0,
        currentPageY: 0,
        currentTimeStamp: 0,
        previousPageX: 0,
        previousPageY: 0,
        previousTimeStamp: 0,
      },
    ],
  };
}

// The sheet only claims the responder on a downward move (so content inside
// can still scroll), and RNTL's fireEvent skips responder events on views that
// don't claim on start. So drive the PanResponder handlers directly.
async function swipeDown(target: { props: Record<string, (e: unknown) => unknown> }, distance: number, ms: number) {
  const history = newHistory();
  const { props } = target;
  await act(async () => {
    // Finger down at y 0, then a 20 pt downward move. As on a device, the
    // capture phase runs first (PanResponder records the move there), then
    // the bubble phase, where the sheet claims it.
    const firstMove = touch(history, 20, 10);
    expect(props.onMoveShouldSetResponderCapture(firstMove)).toBe(false);
    expect(props.onMoveShouldSetResponder(firstMove)).toBe(true);
    props.onResponderGrant(touch(history, 20, 10));
    props.onResponderMove(touch(history, 20 + distance, 10 + ms));
    props.onResponderRelease(touch(history, 20 + distance, 10 + ms));
  });
}

/** A screen that owns the sheet's visibility, the way a real screen would. */
function Harness({ onSecondary }: { onSecondary?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <Text>Open</Text>
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Cancel my spot"
        primaryAction={{ label: 'Cancel my spot', onPress: () => {} }}
        secondaryAction={{ label: 'Keep my spot', onPress: onSecondary }}>
        <Text>Your €6.80 is released.</Text>
      </Sheet>
    </>
  );
}

describe('shouldCloseOnSwipe', () => {
  it.each([
    [120, 0.1, true],
    [20, 1.2, true],
    [20, 0.1, false],
    [-150, -2, false],
  ])('dy %d, vy %d -> %s', (dy, vy, expected) => {
    expect(shouldCloseOnSwipe(dy, vy)).toBe(expected);
  });
});

describe.each([false, true])('Sheet (Reduce Motion %s)', (reduceMotion) => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduceMotion);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function settle() {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }

  it('renders its title, content and actions when open', async () => {
    await render(<Harness />);
    expect(screen.getByRole('header', { name: 'Cancel my spot' })).toBeTruthy();
    expect(screen.getByText('Your €6.80 is released.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep my spot' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('renders nothing when closed', async () => {
    await render(
      <Sheet visible={false} onClose={() => {}} title="Hidden">
        <Text>Hidden content</Text>
      </Sheet>,
    );
    expect(screen.queryByText('Hidden content')).toBeNull();
  });

  it('closes on the secondary button, after running its handler', async () => {
    const onSecondary = jest.fn();
    await render(<Harness onSecondary={onSecondary} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Keep my spot' }));
    await settle();
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Your €6.80 is released.')).toBeNull();
  });

  it('closes on the close button', async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await settle();
    expect(screen.queryByText('Your €6.80 is released.')).toBeNull();
  });

  it('closes on swipe down', async () => {
    await render(<Harness />);
    await swipeDown(screen.getByTestId('sheet'), 200, 400);
    await settle();
    expect(screen.queryByText('Your €6.80 is released.')).toBeNull();
  });

  it('stays open after a short, slow drag', async () => {
    await render(<Harness />);
    await swipeDown(screen.getByTestId('sheet'), 20, 400);
    await settle();
    expect(screen.getByText('Your €6.80 is released.')).toBeTruthy();
  });

  it('does not close on the primary action by itself', async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Cancel my spot' })[0]);
    await settle();
    expect(screen.getByText('Your €6.80 is released.')).toBeTruthy();
  });
});

// Shared sizes and motion for components/ui (docs/specs/15-design.md section 3).
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';

/** Smallest touch target, in points. */
export const MIN_TOUCH = 44;

/** Icons are 20 or 24 points. */
export const ICON = { small: 20, regular: 24 } as const;

/** Animations explain change only, 200-250 ms with standard easing. */
export const MOTION = { duration: 250, easing: Easing.bezier(0.2, 0, 0, 1) } as const;

/** Opacity of a control that can't be used right now. */
export const DISABLED_OPACITY = 0.4;

/** True while the system "Reduce motion" setting is on. Animations jump to their end state. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => mounted && setReduce(value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);
  return reduce;
}

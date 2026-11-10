import { render, screen } from '@testing-library/react-native';

import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { flatStyle } from '@/components/ui/test-utils';
import { colors, radius } from '@/constants/futty-theme';

describe('Skeleton', () => {
  it('renders a block of the given shape', async () => {
    await render(<SkeletonBlock width={120} height={68} />);
    const block = screen.getByTestId('skeleton-block');
    expect(flatStyle(block)).toMatchObject({
      width: 120,
      height: 68,
      borderRadius: radius.card,
      backgroundColor: colors.border,
    });
  });

  it('renders text lines, the last one shorter', async () => {
    await render(<SkeletonText lines={3} />);
    const lines = screen.getAllByTestId('skeleton-line');
    expect(lines).toHaveLength(3);
    expect(flatStyle(lines[0]).width).toBe('100%');
    expect(flatStyle(lines[2]).width).toBe('60%');
  });

  it('is announced as loading', async () => {
    await render(<SkeletonText />);
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });
});

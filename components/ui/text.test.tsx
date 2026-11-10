import { render, screen } from '@testing-library/react-native';

import { Text } from '@/components/ui/text';
import { flatStyle } from '@/components/ui/test-utils';
import { colors, type } from '@/constants/futty-theme';

describe('Text', () => {
  it('defaults to body in ink', async () => {
    await render(<Text>Hello</Text>);
    expect(flatStyle(screen.getByText('Hello'))).toMatchObject({ ...type.body, color: colors.ink });
  });

  it.each(Object.keys(type) as (keyof typeof type)[])('renders the %s variant', async (variant) => {
    await render(<Text variant={variant}>Sample</Text>);
    expect(flatStyle(screen.getByText('Sample'))).toMatchObject(type[variant]);
  });

  it('applies a tone and tabular figures', async () => {
    await render(
      <Text tone="danger" tabular>
        €6.80
      </Text>,
    );
    expect(flatStyle(screen.getByText('€6.80'))).toMatchObject({ color: colors.danger, fontVariant: ['tabular-nums'] });
  });

  it('lets text scale with Dynamic Type', async () => {
    await render(<Text>Scales</Text>);
    expect(screen.getByText('Scales').props.allowFontScaling).not.toBe(false);
  });
});

import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { colors } from '@/constants/futty-theme';

const cases: [NonNullable<ThemedTextProps['type']>, { fontSize: number; lineHeight: number; fontFamily: string; color: string }][] = [
  ['default', { fontSize: 15, lineHeight: 20, fontFamily: 'Inter_400Regular', color: colors.ink }],
  ['defaultSemiBold', { fontSize: 17, lineHeight: 22, fontFamily: 'Inter_600SemiBold', color: colors.ink }],
  ['title', { fontSize: 28, lineHeight: 34, fontFamily: 'Inter_700Bold', color: colors.ink }],
  ['subtitle', { fontSize: 22, lineHeight: 28, fontFamily: 'Inter_700Bold', color: colors.ink }],
  ['link', { fontSize: 15, lineHeight: 20, fontFamily: 'Inter_400Regular', color: colors.brand }],
];

describe('ThemedText', () => {
  it.each(cases)('renders type %s on the new scale', async (textType, expected) => {
    await render(<ThemedText type={textType}>Sample</ThemedText>);
    const style = StyleSheet.flatten(screen.getByText('Sample').props.style);
    expect(style).toMatchObject(expected);
  });
});

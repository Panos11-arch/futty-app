import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhoneField } from '@/components/phone-field';
import { COUNTRIES } from '@/lib/countries';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/components/popup-modal', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PopupModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View>{children}</View> : null,
  };
});

const cyprus = COUNTRIES.find((c) => c.iso2 === 'CY')!;
const greece = COUNTRIES.find((c) => c.iso2 === 'GR')!;

describe('PhoneField', () => {
  it('shows the country as its code and dial code, never a flag emoji', async () => {
    await render(<PhoneField country={cyprus} national="" onChangeCountry={jest.fn()} onChangeNational={jest.fn()} />);
    expect(screen.getByText('CY +357')).toBeTruthy();
    expect(screen.queryByText(/\p{Extended_Pictographic}/u)).toBeNull();
  });

  it('picks a country from the list and types the national number', async () => {
    const onChangeCountry = jest.fn();
    const onChangeNational = jest.fn();
    await render(
      <PhoneField country={cyprus} national="" onChangeCountry={onChangeCountry} onChangeNational={onChangeNational} />
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Country code, Cyprus +357' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Greece +30' }));
    expect(onChangeCountry).toHaveBeenCalledWith(greece);
    await fireEvent.changeText(screen.getByLabelText('Phone number'), '99123456');
    expect(onChangeNational).toHaveBeenCalledWith('99123456');
  });
});

import { deviceLanguage, languageOf } from '@/lib/language';

describe('languageOf', () => {
  it.each(['el', 'el-GR', 'el-CY', 'el_GR', 'EL-gr'])('reads %s as Greek', (locale) => {
    expect(languageOf(locale)).toBe('el');
  });

  it.each(['en', 'en-GB', 'en-CY', 'de-DE', 'ell', 'tr-CY', '', null, undefined])('reads %s as English', (locale) => {
    expect(languageOf(locale)).toBe('en');
  });
});

describe('deviceLanguage', () => {
  const real = Intl.DateTimeFormat;
  afterEach(() => {
    Intl.DateTimeFormat = real;
  });

  const phoneSetTo = (locale: string) => {
    Intl.DateTimeFormat = (() => ({ resolvedOptions: () => ({ locale }) })) as unknown as typeof Intl.DateTimeFormat;
  };

  it('is Greek on a phone set to Greek', () => {
    phoneSetTo('el-GR');
    expect(deviceLanguage()).toBe('el');
  });

  it('is English on a phone set to anything else', () => {
    phoneSetTo('en-GB');
    expect(deviceLanguage()).toBe('en');
  });

  it('is English when the locale can’t be read', () => {
    Intl.DateTimeFormat = (() => {
      throw new Error('no Intl');
    }) as unknown as typeof Intl.DateTimeFormat;
    expect(deviceLanguage()).toBe('en');
  });
});

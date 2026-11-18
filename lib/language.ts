// Which language the phone is set to, for the few texts Futty has in Greek
// (today only the Terms of use, lib/terms-el.ts). The app has no i18n
// library: everything else is English. This reads the locale through Intl
// (Hermes asks the phone), so it needs no new native module and no new
// development build. If it ever reads wrong on a device, expo-localization's
// getLocales() is the replacement, in its own PR with a new build.

export type Language = 'en' | 'el';

/** 'el', 'el-GR', 'el_CY' -> 'el'; anything else -> 'en'. */
export function languageOf(locale: string | null | undefined): Language {
  return /^el(?:$|[-_])/i.test((locale ?? '').trim()) ? 'el' : 'en';
}

/** The phone's language, or English when it can't be read. */
export function deviceLanguage(): Language {
  try {
    return languageOf(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'en';
  }
}

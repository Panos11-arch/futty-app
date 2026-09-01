export type Country = {
  iso2: string;
  name: string;
  dialCode: string;
  flag: string;
  /** Expected digit count of the national (post-dial-code) mobile number. */
  nationalLength: number;
};

// Cyprus first — the app's primary market (every league/venue in this app is
// Cyprus-based) — then the rest roughly by how likely a Futty user is to be
// dialling from/to them. Not exhaustive; add more as real users need them.
export const COUNTRIES: Country[] = [
  { iso2: 'CY', name: 'Cyprus', dialCode: '+357', flag: '🇨🇾', nationalLength: 8 },
  { iso2: 'GR', name: 'Greece', dialCode: '+30', flag: '🇬🇷', nationalLength: 10 },
  { iso2: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧', nationalLength: 10 },
  { iso2: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪', nationalLength: 9 },
  { iso2: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸', nationalLength: 10 },
  { iso2: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦', nationalLength: 10 },
  { iso2: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪', nationalLength: 11 },
  { iso2: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷', nationalLength: 9 },
  { iso2: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹', nationalLength: 10 },
  { iso2: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸', nationalLength: 9 },
  { iso2: 'PT', name: 'Portugal', dialCode: '+351', flag: '🇵🇹', nationalLength: 9 },
  { iso2: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱', nationalLength: 9 },
  { iso2: 'BE', name: 'Belgium', dialCode: '+32', flag: '🇧🇪', nationalLength: 9 },
  { iso2: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭', nationalLength: 9 },
  { iso2: 'AT', name: 'Austria', dialCode: '+43', flag: '🇦🇹', nationalLength: 10 },
  { iso2: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪', nationalLength: 9 },
  { iso2: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴', nationalLength: 8 },
  { iso2: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰', nationalLength: 8 },
  { iso2: 'FI', name: 'Finland', dialCode: '+358', flag: '🇫🇮', nationalLength: 9 },
  { iso2: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱', nationalLength: 9 },
  { iso2: 'RO', name: 'Romania', dialCode: '+40', flag: '🇷🇴', nationalLength: 9 },
  { iso2: 'BG', name: 'Bulgaria', dialCode: '+359', flag: '🇧🇬', nationalLength: 9 },
  { iso2: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷', nationalLength: 10 },
  { iso2: 'IL', name: 'Israel', dialCode: '+972', flag: '🇮🇱', nationalLength: 9 },
  { iso2: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪', nationalLength: 9 },
  { iso2: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬', nationalLength: 10 },
  { iso2: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳', nationalLength: 10 },
  { iso2: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺', nationalLength: 9 },
  { iso2: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿', nationalLength: 9 },
  { iso2: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦', nationalLength: 9 },
  { iso2: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷', nationalLength: 11 },
];

export const DEFAULT_COUNTRY = COUNTRIES[0]; // Cyprus

/** Best-effort split of a stored "+<dial code> <national number>" string —
 *  used to seed the country picker + number field from an existing profile.
 *  Falls back to the default country if the prefix isn't recognised (or
 *  there's no leading '+' at all, e.g. a number saved before this picker
 *  existed). */
export function splitPhone(stored: string | null): { country: Country; national: string } {
  if (!stored || !stored.startsWith('+')) {
    return { country: DEFAULT_COUNTRY, national: stored ?? '' };
  }

  // Longest dial code first, so +1's shorter prefix can't shadow a
  // similarly-prefixed longer code.
  const match = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length).find((c) => stored.startsWith(c.dialCode));

  if (!match) return { country: DEFAULT_COUNTRY, national: stored };
  return { country: match, national: stored.slice(match.dialCode.length).trim() };
}

export function joinPhone(country: Country, national: string) {
  const trimmed = national.trim();
  return trimmed ? `${country.dialCode} ${trimmed}` : '';
}

/** Returns an inline error message, or null if the national number is empty
 *  (optional field) or matches the selected country's expected digit count. */
export function getPhoneNumberError(country: Country, national: string): string | null {
  const digits = national.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length !== country.nationalLength) {
    return `${country.name} numbers should be ${country.nationalLength} digits.`;
  }
  return null;
}

export type Country = {
  iso2: string;
  name: string;
  dialCode: string;
  flag: string;
};

// Cyprus first — the app's primary market (every league/venue in this app is
// Cyprus-based) — then the rest roughly by how likely a Futty user is to be
// dialling from/to them. Not exhaustive; add more as real users need them.
export const COUNTRIES: Country[] = [
  { iso2: 'CY', name: 'Cyprus', dialCode: '+357', flag: '🇨🇾' },
  { iso2: 'GR', name: 'Greece', dialCode: '+30', flag: '🇬🇷' },
  { iso2: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { iso2: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪' },
  { iso2: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { iso2: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { iso2: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { iso2: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { iso2: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { iso2: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { iso2: 'PT', name: 'Portugal', dialCode: '+351', flag: '🇵🇹' },
  { iso2: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { iso2: 'BE', name: 'Belgium', dialCode: '+32', flag: '🇧🇪' },
  { iso2: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭' },
  { iso2: 'AT', name: 'Austria', dialCode: '+43', flag: '🇦🇹' },
  { iso2: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪' },
  { iso2: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴' },
  { iso2: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰' },
  { iso2: 'FI', name: 'Finland', dialCode: '+358', flag: '🇫🇮' },
  { iso2: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱' },
  { iso2: 'RO', name: 'Romania', dialCode: '+40', flag: '🇷🇴' },
  { iso2: 'BG', name: 'Bulgaria', dialCode: '+359', flag: '🇧🇬' },
  { iso2: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷' },
  { iso2: 'IL', name: 'Israel', dialCode: '+972', flag: '🇮🇱' },
  { iso2: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪' },
  { iso2: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬' },
  { iso2: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { iso2: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { iso2: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿' },
  { iso2: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { iso2: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
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

// S7b: the photo check every post photo passes before anyone can see it
// (Panos, 27 November): Google Cloud Vision SafeSearch, called only from the
// community-post Edge Function. The key is the Supabase secret
// GOOGLE_CLOUD_VISION_API_KEY, sent in a header (never in a URL or a file).
//
// A photo is refused if adult or violence is LIKELY or VERY_LIKELY, or racy
// is VERY_LIKELY. If the check fails or times out the photo isn't posted
// (the caller turns the error into "Try again later").

export type Likelihood = 'UNKNOWN' | 'VERY_UNLIKELY' | 'UNLIKELY' | 'POSSIBLE' | 'LIKELY' | 'VERY_LIKELY';

export type SafeSearch = {
  adult: Likelihood;
  spoof?: Likelihood;
  medical?: Likelihood;
  violence: Likelihood;
  racy: Likelihood;
};

/** Checks one JPEG (base64). Throws when it can't answer. */
export type Vision = (jpegBase64: string) => Promise<SafeSearch>;

const LIKELY: Likelihood[] = ['LIKELY', 'VERY_LIKELY'];

/** Whether a photo with this SafeSearch result may be posted. */
export function safeSearchAllows(result: SafeSearch): boolean {
  if (LIKELY.includes(result.adult)) return false;
  if (LIKELY.includes(result.violence)) return false;
  if (result.racy === 'VERY_LIKELY') return false;
  return true;
}

type AnnotateResponse = {
  responses?: { safeSearchAnnotation?: SafeSearch; error?: { message?: string } }[];
};

/** Google Cloud Vision images:annotate, SAFE_SEARCH_DETECTION only. */
export function googleVision(fetchFn: typeof fetch, apiKey: string, { timeoutMs = 8000 } = {}): Vision {
  return async (jpegBase64) => {
    if (!apiKey) throw new Error('vision_key_missing');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn('https://vision.googleapis.com/v1/images:annotate', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          requests: [{ image: { content: jpegBase64 }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }],
        }),
      });
      if (!res.ok) throw new Error(`vision_${res.status}`);
      const body = await res.json() as AnnotateResponse;
      const first = body.responses?.[0];
      if (first?.error) throw new Error(`vision_error: ${first.error.message ?? ''}`);
      const result = first?.safeSearchAnnotation;
      if (!result || !result.adult || !result.violence || !result.racy) throw new Error('vision_no_result');
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
}

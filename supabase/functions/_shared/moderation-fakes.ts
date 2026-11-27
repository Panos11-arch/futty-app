// Fakes for the S7b checks, the counterparts of stripe-fake.ts: no network,
// no keys. Tests never call the real Anthropic or Google Cloud Vision APIs.
//
//   const text = createTextModelFake();           // allows everything
//   text.flag('harassment');                       // flags everything
//   text.fail = new Error('down');                 // the service is down
//   const vision = createVisionFake();             // every photo is safe
//   vision.result = { ...SAFE, adult: 'LIKELY' };
import type { ModelVerdict, TextModel } from './text-check.ts';
import type { SafeSearch, Vision } from './vision.ts';

export const SAFE: SafeSearch = { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'UNLIKELY' };

export type TextModelFake = {
  calls: string[];
  verdict: ModelVerdict;
  fail: Error | null;
  flag(category: string): void;
  model: TextModel;
};

export function createTextModelFake(): TextModelFake {
  const fake: TextModelFake = {
    calls: [],
    verdict: { allowed: true, category: null },
    fail: null,
    flag(category) {
      fake.verdict = { allowed: false, category };
    },
    model: async (text) => {
      fake.calls.push(text);
      if (fake.fail) throw fake.fail;
      return fake.verdict;
    },
  };
  return fake;
}

export type VisionFake = {
  calls: string[];
  /** The answer for every call... */
  result: SafeSearch;
  /** ...unless these, used one per call in order. */
  results: SafeSearch[];
  fail: Error | null;
  vision: Vision;
};

export function createVisionFake(): VisionFake {
  const fake: VisionFake = {
    calls: [],
    result: SAFE,
    results: [],
    fail: null,
    vision: async (jpegBase64) => {
      fake.calls.push(jpegBase64);
      if (fake.fail) throw fake.fail;
      return fake.results.shift() ?? fake.result;
    },
  };
  return fake;
}

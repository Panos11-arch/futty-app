// S7b: the word list the text check runs first (decided 27 November). A hit
// is refused at once, without asking the model. Written in Greek, Greeklish
// or English: text-check.ts turns each term and the post into one spelling
// (normalise), so "πουτάνα", "poutana" and "p0utanaaa" are the same.
//
// Only clear-cut terms belong here: slurs, sexual content, threats,
// self-harm encouragement and child exploitation. Everyday football swearing
// (and "malaka") is left to the model, which reads it in context.
//
// A term matches a whole word that starts with it ("πούστ" matches
// "πούστης", "poustis"); "=term" matches only that whole word (for short
// stems that start other words: "=spic" isn't "spicy"); a term with a space
// matches that phrase.
//
// To add a term: add it to its list and a case to text-check.test.ts.

export type WordCategory = 'hate' | 'sexual' | 'threat' | 'self_harm' | 'child_safety';

export const WORD_LIST: Record<WordCategory, string[]> = {
  hate: [
    // Greek and Greeklish slurs (sexuality, race, ethnicity).
    'πούστ', 'αράπ', 'γύφτο', 'γύφτισσ', 'τουρκόσπορ', 'αλβανόσκυλ',
    // English slurs.
    '=nigger', '=niggers', '=nigga', '=niggas', 'faggot', 'retard', '=tranny', '=trannies', '=kike', '=kikes',
    '=spic', '=spics', 'chink',
  ],
  sexual: [
    'πουτάν', '=μουνί', '=μουνιά', 'καριόλ', 'τσιμπούκ',
    'whore', 'slut', 'blowjob', 'cumshot', 'porn', 'nudes', 'dick pic',
  ],
  threat: [
    'θα σε σκοτώσω', 'θα σε σφάξω', 'θα σε πνίξω',
    'i will kill you', 'ill kill you', 'gonna kill you', 'i will find you and',
  ],
  self_harm: [
    'kill yourself', '=kys', 'go die', 'σκοτώσου', 'αυτοκτόνησε',
  ],
  child_safety: [
    'pedo', 'paedo', 'pedophil', 'child porn', 'παιδόφιλ',
  ],
};

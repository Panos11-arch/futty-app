// js-yaml comes with Jest and ESLint and has no types of its own here. The
// Maestro tests only need these two functions.
declare module 'js-yaml' {
  export function load(text: string): unknown;
  export function loadAll(text: string): unknown[];
}

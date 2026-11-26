// S19: the full-screen QR on the player card raises the screen's brightness
// so a scanner reads it easily, and puts it back on close.
//
// expo-brightness isn't installed yet: adding it changes package.json (a
// shared file) and needs a new development build, so it comes in its own
// small PR (decided 25 November). Until then this does nothing. That PR
// changes only this function: save the brightness, set it to 1, and return
// a restore that puts the saved value back once.

/** Raises the brightness; resolves to a function that restores it. */
export async function raiseBrightness(): Promise<() => void> {
  return () => {};
}

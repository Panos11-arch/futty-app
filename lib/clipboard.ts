// Copy a message's text. React Native 0.83 still ships Clipboard in core
// (deprecated, so it is loaded from its own file to skip the warning; the
// file's JS has a default export, its types a named one). When
// expo-clipboard is added in a shared-files PR, only this file changes.
import type { ClipboardStatic } from 'react-native/Libraries/Components/Clipboard/Clipboard';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Clipboard: ClipboardStatic = require('react-native/Libraries/Components/Clipboard/Clipboard').default;

export function copyText(text: string): void {
  Clipboard.setString(text);
}

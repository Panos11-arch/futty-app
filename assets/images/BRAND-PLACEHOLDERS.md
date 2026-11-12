# Placeholder app icon and splash

The app icon (a white "F" on brand green #0E5A3A) and the splash (the "Futty" wordmark in ink #0B1215 on canvas #F4F5F7) are **placeholders**. They stay until Dimitris finishes the brand work (the logo and wordmark): the Google Drive doc "Futty – Dimitris: Pitch Deck & Business Tasks", task 8 (brand basics and App Store listing).

They were made in U6, set in Inter Bold. The files are:

| File | Size | What it is |
| --- | --- | --- |
| `icon.png` | 1024 × 1024, opaque | iOS and store icon: white F on green |
| `android-icon-foreground.png` | 512 × 512, transparent | Adaptive icon foreground: white F, inside the 66% safe zone |
| `android-icon-background.png` | 512 × 512 | Adaptive icon background: solid green |
| `android-icon-monochrome.png` | 432 × 432, transparent | Themed (monochrome) icon: the F shape |
| `favicon.png` | 48 × 48 | Web favicon |
| `splash-icon.png` | 1024 × 1024, transparent | Splash image: the wordmark only; the background colour comes from `app.json` |

**Swapping in the real brand later means replacing these PNGs only.** Keep the same file names and sizes. `app.json` points at these paths and doesn't need to change, unless the new splash or adaptive icon needs a different background colour (`expo-splash-screen` `backgroundColor`, `android.adaptiveIcon.backgroundColor`). New icons and a new splash need a new build.

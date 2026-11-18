# App icon and splash

The real logo is in: the mint (#00FF9C) rounded "F" with a football, from "Futty logo – light mode (1024).png" in the Futty App Drive folder. These files replaced the U6 placeholders (white "F" on green, and the "Futty" wordmark).

| File | Size | What it is |
| --- | --- | --- |
| `icon.png` | 1024 × 1024, opaque | iOS and store icon: the logo on white |
| `android-icon-foreground.png` | 512 × 512, transparent | Adaptive icon foreground: the mint F, inside the 66% safe zone |
| `android-icon-background.png` | 512 × 512 | Adaptive icon background: solid white |
| `android-icon-monochrome.png` | 432 × 432, transparent | Themed (monochrome) icon: the F as a white silhouette |
| `favicon.png` | 48 × 48 | Web favicon: the logo on white |
| `splash-icon.png` | 1024 × 1024, transparent | Splash image: the mint F; the white background comes from `app.json` |

`app.json` sets white (#FFFFFF) as `android.adaptiveIcon.backgroundColor` and as the `expo-splash-screen` `backgroundColor`.

The app's UI colours are unchanged: the app's brand green (#0E5A3A) and the logo's mint are an open decision for the founders. To change the icon again, replace these PNGs with the same names and sizes. New icons and a new splash need a new build.

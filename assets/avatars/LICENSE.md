# Illustrated avatars

`illustrations.ts` holds 48 avatars drawn with **Avataaars** by Pablo Stanley
(https://avataaars.com/), generated once with DiceBear 9
(`@dicebear/collection` style `avataaars`, by Florian Körner, MIT licence) by
`scripts/avatars/generate.cjs`.

Licence of the art: **"Free for personal and commercial use"**, as published
at https://avataaars.com/ and in DiceBear's metadata for the style. It allows
commercial use and asks for no attribution, so the app shows none.

The drawings are bundled in the app as SVG markup; nothing is loaded from the
network. The ids are in `lib/avatar-illustrations.ts` and are what the server
stores, so the drawings can be regenerated or replaced without changing an id.

# Protagonist document style guide

Documents carry the landing page's identity, a cut-and-paste zine, calmed down for ten minutes of reading. The template (`template.html`) implements everything here; change the template, not individual documents.

## Colour

| Token | Hex | Use |
|---|---|---|
| Paper | `#FFFCF4` | Page background |
| Ink | `#17130F` | Text, borders, offset shadows |
| Muted | `#5C534A` | Secondary text, labels, source lists |
| Cobalt | `#2B3FF6` | Links, section markers, informational callouts, completed timeline dots |
| Sun | `#FFD43B` | The answer panel, highlighter underline, deadline tags |
| Tomato | `#FF5533` | Step numbers, caution callouts, due timeline dots (always with ink text) |
| Blush | `#FFC6DF` | Estimate tags |
| Line | `#E6DDCF` | Table row rules |

Contrast: ink on paper, sun or tomato, and cobalt on paper or white, all pass WCAG AA for body text. Never put small white text on tomato (about 3.2:1). Meaning is never carried by colour alone: tags and callouts always have words.

## Type

- **Anton** (poster, uppercase): the title, section headings, and big numbers in `.facts`. Never body text.
- **Karla:** everything else. Body 17.5–18 px, line height 1.55, prose limited to about 68 characters.
- **Permanent Marker:** the answer label and at most two `.note` asides.
- Fonts are the Latin subsets (English and Spanish), embedded as WOFF2 data URIs by `bin/build.mjs`, with Impact, Trebuchet and Comic Sans fallbacks. Licenses are in `fonts/` (Anton and Karla: SIL OFL 1.1; Permanent Marker: Apache 2.0).

## Shape

- 2–2.5 px ink borders with 12–18 px radius. Only the answer panel has the 6 px offset shadow and a slight rotation, so the eye lands there first.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. Page padding is 20 px on phones and 44 px from 720 px up, with a maximum width of 1,040 px.
- Section headings get the cobalt diamond marker.

## Phones, print, accessibility

- At 360–390 px nothing scrolls sideways except tables, which sit in a bordered `.scroll` region with a swipe hint.
- Print: white background, no shadows or rotation, table headers repeat, cards are not split across pages, and external link URLs are printed after the link.
- One `<h1>`, real `<th>` headers with `scope`, a `<caption>` on every table, the correct `lang`, and descriptive link text. `prefers-reduced-motion` removes rotations.

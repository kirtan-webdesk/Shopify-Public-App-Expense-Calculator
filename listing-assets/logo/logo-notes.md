# App icon — Expense Calculator

Status: PROPOSED for human choice. Agents cannot upload this; steps for the human are in section 5.

## 1. The three concepts

| File | Idea | Why it might work |
|---|---|---|
| `concept-1.svg` | **Split ring.** Four-segment donut (45/25/18/12) on deep navy. | It is the product's own hero visual (the results donut), so the icon and the app read as the same thing. |
| `concept-2.svg` | **Category keypad.** A calculator whose keys are coloured like the expense categories. | Says "calculator" literally; most self-explanatory to a first-time visitor. |
| `concept-3.svg` | **Coin split.** A solid coin with a 30% slice pulled out. | Two shapes only, so it survives the smallest sizes best. Reads as "money, divided". |

All three: 1200 x 1200 viewBox, square canvas with no rounded corners, no text, no Shopify bag, no Shopify green
(`#008060` / `#95BF47`) as the identity. Arcs in concept 1 and 3 are explicit paths (no `stroke-dasharray` or
`pathLength`), so they rasterise the same in a browser, Inkscape, Figma or ImageMagick.

## 2. Recommendation: concept 1 (Split ring)

- It matches what the merchant actually sees in the app (the donut on Results and History detail), which is the
  strongest recognition cue in a crowded Admin sidebar and listing grid.
- Dark tile with four bright, well-separated hues stands out on Admin's light grey sidebar and on the App Store's
  white listing cards, where many icons are pale.
- It is not a generic "pie chart" stock glyph: the ring has a hole and gaps, and the palette is not Shopify's.
- Fallback if the human wants maximum small-size robustness: concept 3.

## 3. Palette (hex)

Concept 1 (recommended)

| Role | Hex |
|---|---|
| Background (ink navy) | `#14213D` |
| Segment A (amber) | `#FFB020` |
| Segment B (teal) | `#2DD4BF` |
| Segment C (coral) | `#FF6B57` |
| Segment D (off-white) | `#F8FAFC` |

Concept 2: background `#EEF0FF`, body `#1B2559`, display `#E7ECFF`, neutral keys `#F1F5F9`, accents `#FFB020`, `#2DD4BF`, `#FF7A59`, `#93C5FD`.
Concept 3: background `#FFF7E8`, coin `#2F3E9E`, slice `#E4572E`.

Contrast (calculated by hand from the WCAG relative-luminance formula, so treat as approximate, not tool-measured):
concept 1 segments against the navy background are all well above 3:1 (amber ~9:1, teal ~9:1, coral ~5.5:1, off-white ~15:1).
Concept 3: slice `#E4572E` on `#FFF7E8` is ~3.5:1; coin `#2F3E9E` on `#FFF7E8` is above 8:1.
Icons are non-text graphics, so the 3:1 non-text guideline is the relevant bar; there is no text in the artwork.

## 4. Legibility check at 32 px and 64 px

I have no shell and cannot render images in this environment, so this is an analytical check, not a screenshot
review. **The human should look at the exported PNG at 32 px and 64 px before uploading** (browser zoom out, or export at those sizes).

Scale factor: 32 px = 0.0267 of 1200; 64 px = 0.0533.

- Concept 1, 32 px: ring band is (420 - 200) = 220 units = ~5.9 px thick; the hole is ~10.7 px across; the largest segment
  (45%) spans about half the circle. The 5-degree gaps are ~0.7 px at the mid-radius, so at 32 px the segments are
  separated mainly by **hue and brightness, not by the gap**. That is acceptable here because every neighbouring pair differs strongly
  (amber/teal, teal/coral, coral/off-white, off-white/amber). If the human wants crisper separation at 16-32 px, widen the gap to 8 degrees.
  At 64 px: ~11.7 px band and ~1.4 px gaps, clearly a segmented ring.
- Concept 2, 32 px: keys are ~4.3 px wide with ~1.3 px gaps, so the 3 x 3 grid is visible but fine; display bar is ~6 px tall.
  At 64 px: crisp. Weakest of the three at 32 px because of the amount of detail.
- Concept 3, 32 px: the coin is ~18 px across and the slice ~9 px; two flat colours. Strongest at 32 px and even at 16 px.

## 5. Shopify app-icon requirements and how to upload (human steps)

Requirements (from the Shopify App Store listing guidance; **verify the current numbers in the Partner Dashboard
uploader at upload time, as Shopify revises them**):

- **1200 x 1200 px**, **JPEG or PNG** (SVG is not accepted, so it must be exported).
- **No rounded corners** on the file: Shopify applies its own rounding. All three concepts have a square canvas.
- No text or images that misrepresent the app; no Shopify logo or trademark lookalikes.

Export the chosen SVG to PNG at exactly 1200 x 1200 (any one of these):
1. Open `concept-1.svg` in Chrome/Edge, then use a "save as PNG" tool or DevTools node screenshot on the `<svg>` element; or
2. Inkscape: File > Export PNG Image, set width 1200 and height 1200, Export; or
3. Figma/Canva: import the SVG onto a 1200 x 1200 frame, Export as PNG at 1x; or
4. ImageMagick: `magick -background none -density 300 concept-1.svg -resize 1200x1200 app-icon-1200.png`.

Then confirm the file is exactly 1200 x 1200 and check the corners are square (no transparent rounded mask).

Upload (labels may differ slightly as the Partner Dashboard changes; verify on screen):
1. Sign in to the Shopify Partner Dashboard (partners.shopify.com) with the account that owns the app.
2. Go to **Apps** and open **Expense Calculator**.
3. Open **Distribution** (or **App Store listing / Manage listing**, wherever the listing editor is on your dashboard version).
4. In the listing editor, find **App icon** (in the "App details" / "Listing" section).
5. Select the 1200 x 1200 PNG or JPEG and upload; wait for the preview to appear.
6. Save the listing draft.

Notes (unverified, check on screen): the same uploaded icon is normally what Shopify shows in the Admin apps list and sidebar; it
is a dashboard setting and I do not expect it to live in `shopify.app.toml`. Some dashboard versions also expose the icon under the
app's **Settings** page, so if you do not find it under Distribution, look there. An agent cannot perform these steps (no dashboard
access), so they are a human task.

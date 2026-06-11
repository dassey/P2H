# PPTX → Single-File HTML Slideshow — Design

Date: 2026-06-10
Status: Approved by owner's brief (autonomous build; the user supplied the target
spec for the generated slideshow and authorized replacing the old fork wholesale:
"you can scrape the entire thing and start fresh").

## Goal

A static web app (GitHub Pages friendly, zero backend, zero build step) where a
user uploads a `.pptx`, picks styling/navigation/animation options, sees a live
preview, and downloads ONE self-contained `.html` slideshow that works offline,
exactly in the shape of the provided spec (full-screen sections, one `active`
slide, fade transition, showSlide() engine, keyboard/touch/button nav,
current/total counters, CSS-variable theme, animated canvas background gated by
a per-slide data attribute).

## Decisions

1. **Start fresh.** The 2015 fork (jQuery/Bootstrap/d3/nvd3/reveal) is removed.
   Only `js/jszip.min.js` (v2.x, the single real dependency), `files/test.pptx`
   (sample/test asset), LICENSE, and git meta files survive.
2. **Content re-style, not pixel cloning.** The converter extracts slide
   *content* (titles, subtitles, bullet hierarchies, images, tables, speaker
   notes) and re-lays it out with the clean flexbox slide design from the spec.
   It does not attempt to reproduce PowerPoint's absolute layout — that is what
   made the old tool brittle, and the user's spec describes the re-styled look.
   Charts/SmartArt are acknowledged with a small placeholder chip rather than
   silently dropped.
3. **Everything client-side.** JSZip unzips in the browser, DOMParser reads the
   XML, images become data URIs (downscaled ≤1600px / JPEG-recompressed by
   default to keep the file emailable; toggle to keep originals).
4. **Generation is a pure function.** `buildDeck(content, options) → html
   string`. The live preview is an `<iframe srcdoc>` re-render of the same
   string the download button saves, so preview ≡ product.
5. **System font stacks instead of embedded fonts.** Satisfies "works offline /
   survives email" without megabytes of base64 woff2. Three choices: clean
   sans, elegant serif, mono.

## Modules

- `js/pptx-extract.js` — `PptxExtract.parse(arrayBuffer, {onProgress, compressImages})`
  → `{ slides: [{type, title, subtitle, blocks[], notes}], themeColors, slideSize, warnings }`.
  Slide order from `ppt/presentation.xml` + its rels. Placeholder types
  (`ctrTitle`/`title`/`subTitle`/`body`) classify text; non-placeholder shapes
  sort by y-position. Blocks: `bullets` (with indent levels), `image`
  (data URI + aspect), `table` (2-D string array), `chartStub`. Slide types
  inferred: `title`, `section`, `content`, `image`, `table`. Theme colors
  (accents, dk1/lt1) parsed from `ppt/theme/theme1.xml` to power a "Original
  deck colors" theme preset.
- `js/backgrounds.js` — `Backgrounds` registry; each entry emits a
  self-contained JS snippet (string) drawing on the full-screen canvas with
  requestAnimationFrame, parameterized by theme colors + intensity. Effects:
  radar (port of the user's example), starfield, constellation, waves,
  fireflies, confetti, snow, none. All honor `data-bg` per slide:
  `feature` (strong) / `subtle` (dim) / `hidden`, faded via CSS class opacity.
- `js/deck-builder.js` — assembles the final HTML: `:root` CSS variables,
  stacked `<section class="slide">`, `.active` + opacity/zoom/slide transition,
  `showSlide(n)` engine, Arrow/PageUp/PageDown/Space/Home/End keys, touch
  swipe, prev/next buttons (placement: bottom-center/left/right or top-right;
  shape: pill/round/square; opacity slider; disabled at ends), counters
  (top-right + between buttons, each toggleable), optional progress bar,
  optional speaker-notes overlay on N, F toggles fullscreen, media queries for
  small windows.
- `js/app.js` + `index.html` + `css/app.css` — the studio UI: hero upload
  (drag/drop or click, .pptx/.ppsx), options sidebar (theme presets incl.
  "Original deck colors" + custom pickers; navigation; effects; typography;
  transition; image handling; notes), live preview iframe with slide stepper,
  Download button (Blob + a[download]). Dark, modern, dependency-free.

## Generated file contract (the user's spec, restated as acceptance criteria)

- One `.html`, no external requests, opens from `file://`, survives email.
- Slides: `<section class="slide">` stacked, `display:none` except `.active`,
  fade-in via opacity transition; 100vw×100vh flexbox-centered content; type
  scales down via media queries.
- All colors defined once as CSS variables at the top.
- `showSlide(n)` is the whole engine: toggles `active`, updates counters,
  disables ends, syncs canvas mode from `data-bg`.
- Keys: →/PageDown/Space forward, ←/PageUp back, Home/End jump. Touch swipe.
- Floating prev/next buttons; "cur / total" counter top-right and between the
  buttons; total computed from `querySelectorAll('.slide').length`.
- Full-screen canvas behind slides (`z-index` below, `pointer-events:none`),
  animation visible per `data-bg` attribute (default: feature on title/section
  slides, subtle elsewhere, per the chosen "where it shows" option).

## Error handling

- Non-zip / corrupt / not-a-pptx → friendly inline error, app stays usable.
- Slides with no recognizable content render as a blank-but-present section
  (count stays faithful to the source deck).
- Image decode failures fall back to skipping that image and adding a warning
  chip in the app (never a broken deck).
- Unsupported elements (charts, SmartArt, video) → labeled placeholder chip
  inside the slide + listed in the post-convert "what was converted" summary.

## Testing

- Serve locally (`python -m http.server`), drive with the headless browse
  tooling: upload `files/test.pptx` (12 slides, images, tables, 8 charts —
  good stress case), assert slide count/preview, capture the generated HTML,
  open it standalone and assert navigation (keys + buttons + counter),
  canvas presence, and zero external resource requests.

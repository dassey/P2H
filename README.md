PPTX2HTML — PowerPoint → single-file HTML slideshow
====================================================

[![MIT License][license-image]][license-url]

Upload a `.pptx`, pick your style, download **one self-contained `.html`** you
can present anywhere: double-click it, press <kbd>F11</kbd>, share the browser
window. No PowerPoint, no internet, no install — fonts, images and navigation
are all embedded, so the file works offline and survives being emailed.

Everything runs **entirely in your browser**. Your presentation is never
uploaded to any server.

Two conversion modes
----

* **Original layout** (default) — slides keep their exact PowerPoint design:
  positions, shapes, colors, icons, tables, even charts (rendered once and
  embedded as static SVG). Powered by the battle-tested renderer from the
  original PPTX2HTML project, framed by this tool's navigation, theming and
  background effects. Theme colors style the backdrop and controls; the
  slides stay yours.
* **Clean restyle** — your content (titles, bullets, images, tables, notes)
  re-flowed into a clean, modern, fully themeable template. Best for simple
  text-and-bullet decks you want to give a fresh coat of paint.

What the exported deck does
----

* Every slide is a full-screen section, one visible at a time with a fade
  (or slide/zoom) transition — driven by a single tiny `showSlide(n)` engine
* **Keyboard**: → / PageDown / Space forward · ← / PageUp back · Home / End
  jump · F fullscreen · N speaker notes (if included)
* **Buttons**: floating prev/next pair that grays out at the ends, plus a
  "3 / 16" counter top-right and between the buttons — totals are counted
  automatically from the number of slides
* **Touch**: swipe left/right on tablets and phones
* **Animated canvas background** that lives *behind* the slides and appears
  only where you choose (title & section slides, faint everywhere, or every
  slide) — pick from radar sweep, starfield, constellation, flow lines,
  fireflies, confetti, or snowfall
* The whole theme is CSS variables at the top of the file, so re-coloring a
  downloaded deck by hand is a five-line edit

Options you can set before downloading
----

* **Theme** — presets (including one derived from your deck's own theme
  colors) or fully custom background / text / accent colors
* **Navigation** — button placement (bottom center/left/right, top right),
  shape (pill / round / square), arrows or labels, resting transparency,
  counters on/off, progress bar on/off
* **Background effect** — which animation, where it shows, and how intense
* **Typography** — clean sans, elegant serif, or typewriter mono (system font
  stacks: zero bloat, always offline)
* **Motion** — fade / slide / zoom / none, animated title underlines, corner
  frames on the title slide
* **Speaker notes** — embed them; press N while presenting to peek
* **Images** — auto-downscale & recompress big pictures so the file stays
  emailable (or keep originals)

What gets converted
----

| From your .pptx | Into the deck |
| --- | --- |
| Slide order, titles, subtitles | Full-screen styled slides (title, section, content layouts) |
| Bullet lists with indent levels | Styled nested bullets |
| Bold / italic / underline / links | Preserved inline |
| Pictures (png, jpg, gif, …) | Embedded as data URIs, auto-arranged |
| Tables | Clean styled tables |
| Speaker notes | Optional presenter panel (N key) |
| Charts / SmartArt | A labeled placeholder chip (not rendered) |

This tool deliberately **re-styles your content** into a clean, modern deck
rather than pixel-cloning PowerPoint's layout — that's the point.

Run it
----

It's a static site. Host it anywhere (GitHub Pages works out of the box) or
run locally:

```
python -m http.server 8000
# open http://localhost:8000
```

Project layout
----

```
index.html          the converter app
css/app.css         app styling
js/app.js           UI state, options, preview, download
js/pptx-extract.js  .pptx → neutral content model (JSZip + DOMParser)
js/deck-builder.js  content + options → single-file slideshow HTML
js/backgrounds.js   the animated canvas effects library
js/jszip.min.js     the one third-party dependency
files/test.pptx     sample presentation ("try the sample" button)
```

Credits & license
----

MIT. This project began as a fork of
[PPTX2HTML by g21589](https://github.com/g21589/PPTX2HTML) and was rebuilt
from scratch around a new converter, generator and UI; the original project's
spirit (pure-JavaScript, in-browser PPTX reading) lives on.

[license-image]: http://img.shields.io/badge/license-MIT-blue.svg?style=flat
[license-url]: LICENSE

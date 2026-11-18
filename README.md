# GoodNotes Converter

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/visoire/goodnotes-converter)](https://github.com/visoire/goodnotes-converter/releases)
[![Client-Side](https://img.shields.io/badge/Runs-100%25%20in%20Browser-22c55e.svg)](#quick-start)

Turn a GoodNotes notebook (`.goodnotes` or backup `.zip`) into a **PDF** or **Word (`.docx`)** file, with or without your handwriting. It runs **entirely in your browser** — nothing is ever uploaded to a server.

---

## Features

- **100% Client-Side & Private:** All parsing, rendering, OCR, and packaging happen locally on your device.
- **Zero Build / Zero Install:** Open `index.html` directly in a browser or host it on any static web server (including GitHub Pages).
- **Flexible Input:** Drop a single `.goodnotes` file, multiple notebooks at once, or a full GoodNotes backup `.zip` (folder structure is preserved in a single "Download all" ZIP).
- **PDF & Word Export:** Export visual PDFs with pen strokes or editable `.docx` documents with browser-based handwriting OCR.
- **Extra Outputs:** Optionally export page images (JPG ZIP), vector pages (SVG ZIP), plain text (`.txt`), and embedded voice recordings (`m4a`, `mp3`, `wav`, `aac`, `caf`).
- **Optional Desktop Bridge:** Includes [`desktop-bridge/bridge.py`](desktop-bridge/bridge.py) for users who want CLI batch conversion via `parser-for-goodnotes` or `inkterop`.

---

## Quick Start

1. **Download or clone** this repository (or grab the latest archive from [Releases](https://github.com/visoire/goodnotes-converter/releases)):
   ```bash
   git clone https://github.com/visoire/goodnotes-converter.git
   cd goodnotes-converter
   ```
2. **Open `index.html`** directly in your browser (or serve the folder with any static server, e.g. `python3 -m http.server 8080`).
3. **Follow the three steps on the page:**
   1. Choose **PDF** or **Word (`.docx`)**.
   2. Toggle **Include my handwriting** on or off.
   3. Drop or browse for your `.goodnotes` file(s) or backup `.zip`.

---

## Output Behavior

| Format | Handwriting ON | Handwriting OFF |
|---|---|---|
| **PDF** (`.pdf`) | Your pen writing is drawn on the pages, like in GoodNotes. | Pages without pen writing. Imported pages, pictures, and typed text stay. If the notebook is just an imported PDF, you get that PDF back untouched. |
| **Word** (`.docx`) | Your handwriting is turned into typed, editable text. Imported pages are added as pictures. Any page that cannot be read as text is added as a picture so nothing is lost. | Pages as pictures, without pen writing. |

### Optional Extras (collapsed by default)

Open **Extras** to save additional outputs alongside your main file (never instead of it). The summary line above the drop area always reflects what is enabled.

| Extra | Default | What it does |
|---|---|---|
| Page pictures (JPG) | Off | Saves every page as a JPEG image inside a ZIP. |
| Sharp pages (SVG) | Off | Saves every page as scalable vector drawings inside a ZIP. |
| Text file (`.txt`) | Off | Saves recognized handwriting as plain text (requires **Include my handwriting**). |
| Voice recordings | On | Extracts audio recorded inside the notebook. |
| Use preview image if empty | On | Falls back to `thumbnail.jpg` if a notebook has no readable pages. |

Other behavior:
- **Multiple notebooks or a backup ZIP** generate a single **Download all** ZIP preserving your folder hierarchy and enabled extras.
- A notebook containing only handwriting converted with handwriting **OFF** reports a clear message instead of producing an empty file.

---

## Handwriting to Text (OCR)

When exporting to Word (or `.txt`) with handwriting enabled, text recognition runs locally in the browser using [Tesseract.js](https://github.com/naptha/tesseract.js):

1. Only non-highlighter pen ink is drawn (black on white, with no page template or imported PDF behind it).
2. The ink bounding box is tightly cropped and enlarged (~3×) for legibility.
3. Tesseract runs in single-block mode (`PSM 6`) so handwritten notes are not misclassified as images.
4. Low-confidence and noisy lines are filtered out to keep the resulting document clean.

**Current OCR limits:**
- Configured for **English** (`eng`) and works best on neat handwriting — always review the output.
- Highlighter strokes are excluded from OCR.
- Diagrams, sketches, and mathematical formulas are not converted into editable text (unreadable pages fall back to embedded images in `.docx`).

---

## Honest Limits

- GoodNotes stores vector strokes in a proprietary binary format (Protocol Buffers, Apple Framed LZ4 `bv41`/`bv4-`, and Troy Hanson TPL). The browser stroke reader is heuristic, so pen shapes, pressure dynamics, and eraser cuts can differ slightly from the GoodNotes app, and some newer or unsupported files may not yield strokes.
- For an imported PDF with ink on top, PDF pages are matched to ink pages by notebook page order. If the counts differ, the converter falls back to rendering ink on plain pages.
- For pixel-perfect vector output or native macOS Apple Vision OCR, see [`desktop-bridge/`](desktop-bridge/README.md).

---

## Optional Desktop High-Fidelity Bridge

If you need Python CLI automation or exact vector stroke ribbon/eraser reconstruction, see [`desktop-bridge/README.md`](desktop-bridge/README.md) and [`desktop-bridge/bridge.py`](desktop-bridge/bridge.py):

```bash
pip install parser-for-goodnotes
python desktop-bridge/bridge.py notebook.goodnotes
python desktop-bridge/bridge.py full_backup.zip -o ./pdf_exports
```

---

## Project Layout

```text
├── index.html                    # Three-step UI and conversion workflow
├── assets/
│   ├── css/
│   │   └── style.css             # Atelier dark theme styling
│   ├── img/                      # Logo and favicons
│   └── js/
│       ├── handwriting.js        # GoodNotes binary parser (LZ4/TPL/Protobuf) & stroke renderer
│       ├── ocr.js                # Handwriting-to-text OCR (Tesseract.js, loaded on demand)
│       ├── pdf-pages.js          # Imported PDF page renderer (pdf.js, loaded on demand)
│       ├── audio.js              # Voice recording detector & extractor
│       ├── zip-handler.js        # Archive inspector & "Download all" ZIP builder
│       └── exporters/
│           ├── docx.js           # Word (.docx) builder (docx.js, loaded on demand)
│           ├── images.js         # Page pictures (JPG ZIP) exporter
│           └── svg.js            # Vector pages (SVG ZIP) exporter
├── desktop-bridge/
│   ├── bridge.py                 # Optional Python CLI wrapper
│   └── README.md                 # Desktop high-fidelity tools guide
├── goodnotes-converter.md        # Technical format reference & bidirectional spec
├── CHANGELOG.md                  # Version history
├── CONTRIBUTING.md               # Contribution guidelines
└── LICENSE                       # MIT License
```

External browser libraries are loaded from public CDNs: **JSZip** and **jsPDF** (`cdnjs`, loaded with the page), plus **Tesseract.js**, **docx**, and **pdf.js** (loaded on demand when needed). The first Word conversion with handwriting downloads the English Tesseract trained data once.

---

## Browser Support

Works in any modern **Chrome**, **Edge**, **Firefox**, or **Safari**.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on local development, reporting bugs, and submitting pull requests.

## License

Released under the [MIT License](LICENSE).

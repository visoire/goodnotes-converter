# Contributing to GoodNotes Converter

Thank you for your interest in contributing to **GoodNotes Converter**!

## Project Structure

The core converter is a zero-build static web application written in vanilla HTML, CSS, and JavaScript:

- `index.html` — Three-step UI and conversion orchestration
- `assets/css/style.css` — Dark-themed UI styles
- `assets/js/handwriting.js` — Binary GoodNotes parser (Protobuf, Apple Framed LZ4 `bv41`/`bv4-`, Troy Hanson TPL) and stroke renderer
- `assets/js/ocr.js` — Browser-based handwriting-to-text OCR via Tesseract.js
- `assets/js/pdf-pages.js` — Imported PDF background renderer via pdf.js
- `assets/js/audio.js` — Embedded voice recording detector and extractor (`m4a`, `mp3`, `wav`, `aac`, `caf`)
- `assets/js/zip-handler.js` — `.goodnotes` / backup `.zip` inspector and batch archive builder
- `assets/js/exporters/` — Output builders for `.docx`, `.jpg` ZIP, and `.svg` ZIP
- `desktop-bridge/` — Optional Python CLI wrapper for `parser-for-goodnotes` / `inkterop`

## Local Development

No build step or bundler is required.

1. Clone the repository:
   ```bash
   git clone https://github.com/visoire/goodnotes-converter.git
   cd goodnotes-converter
   ```
2. Open `index.html` directly in your browser, or serve the folder over HTTP:
   ```bash
   python3 -m http.server 8080
   ```
   Then visit `http://localhost:8080`.

## Submitting Changes

1. Fork the repository and create a feature branch (`git checkout -b feat/my-improvement`).
2. Keep changes focused and preserve the client-side, privacy-first design (no server uploads).
3. Test your changes in a modern browser (Chrome, Edge, Firefox, or Safari) across single `.goodnotes` files and `.zip` backups.
4. Open a pull request describing what changed and why.

## Reporting Issues

When opening an issue, please include:
- Browser and OS version
- Export format and settings used (PDF/Word, handwriting on/off, extras enabled)
- Whether the input was a single `.goodnotes` file or a backup `.zip`
- Any console error messages (please avoid attaching private notebooks unless anonymized)

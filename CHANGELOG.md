# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-18

### Added
- Client-side GoodNotes converter running 100% in the browser with zero server uploads.
- Support for single `.goodnotes` notebooks, multiple notebooks at once, and full GoodNotes backup `.zip` archives (preserving folder structure).
- **PDF export** (`.pdf`) with optional handwriting stroke rendering or untouched imported PDF pass-through when handwriting is excluded.
- **Word export** (`.docx`) with on-demand local OCR (`Tesseract.js`) for handwritten pages, automatic image fallback for unreadable pages, and embedded imported pages.
- **Binary ink decoder** supporting Protobuf streams, Apple Framed LZ4 (`bv41` / `bv4-` / `bv4$`), and Troy Hanson TPL (`tpl`) stroke data.
- **Optional Extras**:
  - Page pictures (`.jpg` pages in a ZIP)
  - Sharp vector pages (`.svg` pages in a ZIP)
  - Plain text transcript (`.txt` via OCR)
  - Voice recording extraction (`m4a`, `mp3`, `wav`, `aac`, `caf`)
  - Thumbnail fallback for empty/unreadable notebooks
- **Desktop High-Fidelity Bridge** (`desktop-bridge/bridge.py`) wrapping `parser-for-goodnotes` and `inkterop` for power users needing native Python vector export.
- Open-source documentation (`README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and MIT `LICENSE`).

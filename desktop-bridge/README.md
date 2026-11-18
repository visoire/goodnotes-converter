# Desktop High-Fidelity Bridge

For everyday conversion, the pure client-side web converter (`index.html`) requires **zero setup, zero server uploads, and works across Windows, macOS, and Linux**.

However, because GoodNotes encodes vector ink, pen pressure curves, shader ribbons, and eraser cutouts into proprietary binary structures (Protobuf + Apple Framed LZ4 + Troy Hanson TPL), advanced users needing **pixel-perfect vector replication or native Apple Vision OCR** can leverage these mature open-source command-line tools.

---

## Recommended High-Fidelity Desktop Tools

### 1. `parser-for-goodnotes` (Kaih1825)
Re-implements stroke ribbon generation, pressure dynamics, and eraser polygon clipping in Python.

- **Capabilities**:
  - Exports exact vector PDF / SVG paths.
  - Interactive web player with timeline stroke replay (`player.html`).
- **Installation & Usage**:
  ```bash
  # Install via pip/uv
  pip install parser-for-goodnotes

  # Convert a notebook to vector PDF
  gn-export-pdf my_notebook.goodnotes -o output.pdf

  # Convert to vector SVG
  gn-export-svg my_notebook.goodnotes -o output_pages/
  ```

### 2. `inkterop` (Multi-Format Vector Converter)
Converts GoodNotes notebooks to interoperable open formats (Xournal++, InkML, SVG, PDF).

- **Capabilities**:
  - Edit GoodNotes notebooks inside Xournal++ on desktop.
- **Installation & Usage**:
  ```bash
  pip install inkterop
  inkterop convert my_notes.goodnotes my_notes.xopp
  ```

### 3. `goodnotes-mcp` (Apple Vision OCR on macOS)
Uses native macOS Apple Vision API to perform OCR on handwritten notes with high precision.

---

## Automated Desktop Bridge Script

This folder includes `bridge.py`, an automated Python wrapper that can process single files or entire backup ZIP archives:

```bash
# Convert a single notebook
python desktop-bridge/bridge.py notebook.goodnotes

# Convert a full library backup ZIP preserving folders
python desktop-bridge/bridge.py full_backup.zip -o ./pdf_exports
```


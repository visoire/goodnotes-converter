---
name: goodnotes-converter
description: Vollständiger, eigenständiger und bidirektionaler GoodNotes-Spezialist (Skill & Wissensbasis) für den KI-Agenten. Beherrscht das Dekodieren, Entpacken und Konvertieren von .goodnotes-Dateien und Backup-ZIPs (inkl. Apple Framed LZ4 bv41/bv4-, Troy Hanson TPL, Protobuf-Streams, Vektor-Strokes, PDF-Layern, Audio-Aufnahmen und Ink-Only-OCR) in PDF, Word (.docx), SVG, JPG, Markdown/LaTeX und DIN-A4-Merkzettel sowie den Rückweg: Erstellen echter .goodnotes-Archive und beschreibbarer GoodNotes-Vorlagen/Worksheets.
---

# GoodNotes Converter & Bidirektionaler Agent-Skill (`goodnotes-converter`)

> **Zweck & Funktionsweise im KI-Agenten:**  
> Dieses Dokument befähigt den KI-Agenten, völlig eigenständig in seiner eigenen Laufzeitumgebung (Python / Code-Interpreter) in **beide Richtungen** mit **GoodNotes 5 & GoodNotes 6** zu arbeiten:
> 1. **INBOUND (`.goodnotes` / Backup-`.zip` → PDF, Word `.docx`, SVG, Bilder, Audio, Markdown, DIN-A4-Merkblatt):** Hochgeladene `.goodnotes`-Dateien entpacken, Hintergrund-PDFs, Bilder, Sprachaufnahmen, Suchindizes und komprimierte Vektor-Handschrift (`bv41`/`bv4-`, `tpl`, Protobuf) dekodieren, rendern und in das gewünschte Zielformat überführen.
> 2. **OUTBOUND (Thema / Markdown / PDF → `.goodnotes`-Datei & beschreibbares GoodNotes-Worksheet):** Maßgeschneiderte, auf dem iPad mit dem Apple Pencil beschreibbare GoodNotes-Arbeitsblätter (mit 5-mm-Karogitter, Cornell-Layout, Original-Papierfarben und klickbaren Lösungslinks) sowie valide `.goodnotes`-Containerdateien erzeugen.

---

## 1. Technische Anatomie des `.goodnotes`-Formats

Eine `.goodnotes`-Datei ist ein **ZIP-Container** (Magic Bytes `PK\x03\x04` bzw. `50 4B 03 04`) mit folgender interner Struktur:

```text
notebook.goodnotes (ZIP-Container)
├── thumbnail.jpg              # JPEG-Vorschaubild des Notizbuchs / der ersten Seite
├── schema.pb                  # (Optional) Schema-/Versions-Metadaten
├── index.events.pb            # Master-Event-Log (Protobuf): Chronologie, UUID-Seitenreihenfolge, Tombstones
├── index.notes.pb             # Seiten- & Notizbuch-Index (Protobuf): geordnete Seiten-UUIDs & Papier-Templates
├── index.attachments.pb       # Mapping-Tabelle (Protobuf): Logische Attachment-UUID -> Datei-UUID in attachments/
├── index.search.pb            # Handschrift-OCR-Suchindex (Protobuf, UTF-8 Teilstrings)
├── attachments/               # Eingebettete Binärdateien (Dateinamen sind UUIDs OHNE Dateiendung!)
│   ├── <UUID-1>               # Importiertes Hintergrund-PDF (%PDF-1.x, 0x25 0x50 0x44 0x46)
│   ├── <UUID-2>               # Eingefügte Bilder / Seitenhintergründe (JPEG: FF D8 FF, PNG: 89 50 4E 47)
│   └── <UUID-3>               # Sprachaufnahmen (M4A: 'ftyp' @ Offset 4..7, MP3, CAF 'caff', WAV, AAC)
├── notes/                     # Seitenweise Vektor-Handschriftdaten (Dateiname = Seiten-UUID)
│   ├── <PAGE-UUID-1>          # Binärer Stream: Protobuf + Apple Framed LZ4 ('bv41'/'bv4-'/'bv4$') + TPL ('tpl')
│   └── <PAGE-UUID-2>          # 0 Bytes = Seite enthält keine handschriftlichen Striche (Strokes)
└── search/                    # Seitenweise OCR-Indizes aus GoodNotes
```

### Drei unterstützte Archiv-Varianten beim Upload
1. **Einzelnes `.goodnotes`-Notizbuch:** Enthält `attachments/`, `notes/`, `index.notes.pb` oder `index.events.pb` direkt auf Root-Ebene.
2. **Backup-`.zip` mit gepackten `.goodnotes`-Dateien:** Enthält mehrere `*.goodnotes`-Dateien in Unterordnern.
3. **Backup-`.zip` mit entpackten Notizbuch-Ordnern:** Enthält Unterordner `<NotebookName>/attachments/...` und `<NotebookName>/notes/...`.

---

## 2. Richtung A (INBOUND): `.goodnotes` vollständig dekodieren & konvertieren

### 2.1 Binär-Dekodierung der Handschrift (`notes/<UUID>`)
GoodNotes speichert Stiftstriche (Strokes), Textmarker (Highlighter), Druckstufen und Farben in einer mehrschichtigen Binärstruktur. Die exakte Dekodier-Kaskade lautet:

1. **Apple Framed LZ4 Dekompression (`bv41` / `bv4-` / `bv4$`):**
   - Suche im Byte-Stream nach den Magic-Markern `bv41` (`0x62 0x76 0x34 0x31`, komprimierter Chunk) oder `bv4-` (`0x62 0x76 0x34 0x2D`, unkomprimierter Chunk).
   - **`bv41`-Header:** 4 Bytes Marker + `uint32_le uncompressedSize` + `uint32_le compressedSize` + LZ4-Block-Payload.
   - **`bv4-`-Header:** 4 Bytes Marker + `uint32_le uncompressedSize` + Rohdaten.
   - **`bv4$`-Terminator (`0x62 0x76 0x34 0x24`):** Beendet den Stream.
   - **Wichtig:** Chunks nutzen ein **64 KB (`65536` Bytes) Sliding Dictionary** aus den jeweils zuvor dekomprimierten Chunks.
2. **Troy Hanson TPL Parser (`tpl` = `0x74 0x70 0x6C`):**
   - Nach `tpl` folgen 1 Flag-Byte, 4 Längen-Bytes und ein Null-terminierter Format-String (z. B. `A(ff)` für `x, y` oder `A(fff)` für `x, y, pressure`), gefolgt von `uint32_le count` und Little-Endian `float32`-Tupeln.
   - Ein **Pen-Lift** (neuer Strich) liegt vor, wenn der euklidische Abstand $\sqrt{\Delta x^2 + \Delta y^2} > \max(0.22 \cdot W, 160)$ ist oder `pressure <= 0.001`.
3. **Protobuf Wire-Format & Float-Stream-Extraktion:**
   - Liest Length-Delimited Protobuf-Messages (`read_varint` → `tag >> 3` = `field_num`, `tag & 0x7` = `wire_type`).
   - **Farbe & Stifttyp:** `varint` auf `field_num` 3 oder 4 mit `val > 0x00FFFFFF` liefert RGB (`r = (val >> 16) & 0xFF`, `g = (val >> 8) & 0xFF`, `b = val & 0xFF`). `field_num == 5` und `val == 3` markiert einen **Highlighter (Textmarker)** (`opacity = 0.38`, `mix-blend-mode: multiply`, `width = 14`).
   - **Strichstärke:** `fixed32` (`float32_le`) im Bereich `0.1 .. 50`.
   - **Koordinaten-Skalierung:** Liegen $\ge 70\,\%$ der endlichen `float32`-Paare in `[-0.05, 1.05]`, sind die Koordinaten auf `[0.0 .. 1.0]` normiert und werden mit `(pageWidth, pageHeight)` multipliziert; bei Retina-Koordinaten (`maxVal > 2500`) wird proportional auf die Zielseite skaliert.
4. **Glatte Vektor-Kurven-Rekonstruktion (Quadratic Bézier):**
   - Ab 3 Punkten pro Strich wird zwischen den Mittelpunkten $\text{mid}_i = \frac{P_i + P_{i+1}}{2}$ über quadratische Bézier-Kurven (`M ... Q ... L ...`) interpoliert.

---

### 2.2 Vollständige Python-Referenzpipeline für den KI-Agenten (Inbound)

Führe diesen selbstständigen Python-Code aus, sobald der Nutzer eine `.goodnotes`-Datei oder ein `.zip`-Backup hochlädt:

```python
#!/usr/bin/env python3
"""
Eigenständiger GoodNotes-Extraktor, Binär-Dekodierer & Konverter
Entpackt .goodnotes-Archive, stellt PDFs, Bilder und Sprachaufnahmen wieder her,
dekodiert Apple Framed LZ4 ('bv41'/'bv4-'), TPL und Protobuf-Strokes und erzeugt SVG/PDF/Text.
"""
import os
import re
import math
import struct
import zipfile
from pathlib import Path

# ---------------------------------------------------------------------------
# 1. APPLE FRAMED LZ4 ('bv41' / 'bv4-' / 'bv4$') DEKOMPRESSION
# ---------------------------------------------------------------------------
def decompress_lz4_block(src: bytes, uncompressed_size: int, dict_buf: bytes = b"") -> bytes:
    if uncompressed_size <= 0 or uncompressed_size > 50 * 1024 * 1024:
        raise ValueError(f"Ungültige Zielgröße: {uncompressed_size}")
    dst = bytearray()
    src_pos = 0
    src_len = len(src)
    dict_len = len(dict_buf)

    while src_pos < src_len and len(dst) < uncompressed_size:
        token = src[src_pos]
        src_pos += 1
        lit_len = token >> 4
        if lit_len == 15:
            while src_pos < src_len:
                b = src[src_pos]
                src_pos += 1
                lit_len += b
                if b != 255:
                    break
        take = min(lit_len, uncompressed_size - len(dst), src_len - src_pos)
        dst.extend(src[src_pos:src_pos + take])
        src_pos += take

        if len(dst) >= uncompressed_size or src_pos + 2 > src_len:
            break

        offset = src[src_pos] | (src[src_pos + 1] << 8)
        src_pos += 2
        if offset == 0:
            break

        match_len = token & 0x0F
        if match_len == 15:
            while src_pos < src_len:
                b = src[src_pos]
                src_pos += 1
                match_len += b
                if b != 255:
                    break
        match_len += 4

        for _ in range(match_len):
            if len(dst) >= uncompressed_size:
                break
            match_idx = len(dst) - offset
            if match_idx >= 0:
                dst.append(dst[match_idx])
            elif dict_len > 0 and (match_idx + dict_len) >= 0:
                dst.append(dict_buf[match_idx + dict_len])
            else:
                dst.append(0)

    return bytes(dst)


def decompress_apple_bv4(data: bytes) -> bytes:
    if not data or len(data) < 8:
        return data
    idx_41 = data.find(b"bv41")
    idx_4d = data.find(b"bv4-")
    candidates = [i for i in (idx_41, idx_4d) if i != -1]
    if not candidates:
        return data

    pos = min(candidates)
    chunks = []
    total_len = 0
    max_total = 80 * 1024 * 1024
    sliding_dict = b""

    while pos + 4 <= len(data):
        marker = data[pos:pos + 4]
        if marker == b"bv4$":
            break
        elif marker == b"bv4-":
            pos += 4
            if pos + 4 > len(data):
                break
            u_size = struct.unpack_from("<I", data, pos)[0]
            pos += 4
            if u_size == 0 or pos + u_size > len(data) or total_len + u_size > max_total:
                break
            chunk = data[pos:pos + u_size]
            pos += u_size
            chunks.append(chunk)
            total_len += len(chunk)
            sliding_dict = (sliding_dict + chunk)[-65536:]
        elif marker == b"bv41":
            pos += 4
            if pos + 8 > len(data):
                break
            u_size, c_size = struct.unpack_from("<II", data, pos)
            pos += 8
            if u_size == 0 or c_size == 0 or pos + c_size > len(data) or total_len + u_size > max_total:
                break
            comp_data = data[pos:pos + c_size]
            pos += c_size
            try:
                decomp = decompress_lz4_block(comp_data, u_size, sliding_dict)
                chunks.append(decomp)
                total_len += len(decomp)
                sliding_dict = (sliding_dict + decomp)[-65536:]
            except Exception:
                break
        else:
            break

    return b"".join(chunks) if chunks else data


# ---------------------------------------------------------------------------
# 2. PROTOBUF, TPL & FLOAT-STROKE-EXTRAKTOR
# ---------------------------------------------------------------------------
def read_varint(data: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while pos < len(data):
        b = data[pos]
        result |= (b & 0x7F) << shift
        pos += 1
        if (b & 0x80) == 0:
            break
        shift += 7
        if shift > 35:
            break
    return (result & 0xFFFFFFFF, pos)


def decode_proto_fields(data: bytes, start: int = 0, end: int | None = None) -> list[dict]:
    if end is None:
        end = len(data)
    fields = []
    pos = start
    while pos < end:
        tag, pos = read_varint(data, pos)
        field_num = tag >> 3
        wire_type = tag & 0x7
        if field_num == 0:
            break
        if wire_type == 0:
            val, pos = read_varint(data, pos)
            fields.append({"fieldNum": field_num, "type": "varint", "value": val})
        elif wire_type == 1:
            if pos + 8 > end:
                break
            fields.append({"fieldNum": field_num, "type": "fixed64", "value": data[pos:pos + 8]})
            pos += 8
        elif wire_type == 2:
            length, pos = read_varint(data, pos)
            if length < 0 or pos + length > end:
                break
            fields.append({"fieldNum": field_num, "type": "bytes", "value": data[pos:pos + length]})
            pos += length
        elif wire_type == 5:
            if pos + 4 > end:
                break
            fields.append({"fieldNum": field_num, "type": "fixed32", "value": data[pos:pos + 4]})
            pos += 4
        else:
            break
    return fields


def parse_tpl_image(data: bytes, width: float = 800.0, height: float = 1000.0) -> list[dict]:
    if not data or len(data) < 8:
        return []
    tpl_offset = data.find(b"tpl")
    if tpl_offset == -1:
        return []
    pos = tpl_offset + 3 + 1 + 4  # 'tpl' + flags + length
    if pos >= len(data):
        return []
    fmt_chars = []
    while pos < len(data) and data[pos] != 0 and len(fmt_chars) < 64:
        fmt_chars.append(chr(data[pos]))
        pos += 1
    if pos < len(data) and data[pos] == 0:
        pos += 1
    fmt = "".join(fmt_chars)
    strokes = []
    if "A(" in fmt and pos + 4 <= len(data):
        count = min(struct.unpack_from("<I", data, pos)[0], 50000)
        pos += 4
        is_fff = "fff" in fmt
        floats_per_item = 3 if is_fff else 2
        curr = []
        max_step = max(width * 0.22, 160.0)
        for _ in range(count):
            if pos + floats_per_item * 4 > len(data):
                break
            vals = struct.unpack_from("<fff" if is_fff else "<ff", data, pos)
            pos += floats_per_item * 4
            x, y = vals[0], vals[1]
            p = vals[2] if is_fff else 1.0
            if not (math.isfinite(x) and math.isfinite(y)):
                if len(curr) > 1:
                    strokes.append({"points": curr, "width": 2.0, "color": "#1a1a1a", "isHighlighter": False})
                curr = []
                continue
            if curr:
                dist = math.hypot(x - curr[-1][0], y - curr[-1][1])
                if dist > max_step or (is_fff and p <= 0.001):
                    if len(curr) > 1:
                        strokes.append({"points": curr, "width": 2.0, "color": "#1a1a1a", "isHighlighter": False})
                    curr = []
            curr.append((x, y))
        if len(curr) > 1:
            strokes.append({"points": curr, "width": 2.0, "color": "#1a1a1a", "isHighlighter": False})
    return strokes


def extract_strokes_from_float_buffer(buf: bytes, width: float = 800.0, height: float = 1000.0,
                                      color: str = "#1a1a1a", stroke_w: float = 2.0,
                                      is_highlighter: bool = False) -> list[dict]:
    if not buf or len(buf) < 24:
        return []
    float_count = len(buf) // 4
    if float_count < 6:
        return []
    floats = struct.unpack_from(f"<{float_count}f", buf)

    valid_norm, finite_cnt, max_val = 0, 0, 0.0
    for i in range(0, min(len(floats) - 1, 40), 2):
        x, y = floats[i], floats[i + 1]
        if math.isfinite(x) and math.isfinite(y):
            finite_cnt += 1
            max_val = max(max_val, x, y)
            if -0.05 <= x <= 1.05 and -0.05 <= y <= 1.05:
                valid_norm += 1

    is_norm = finite_cnt >= 4 and (valid_norm / finite_cnt >= 0.7)
    scale_x = width if is_norm else (width / max(width, max_val) if max_val > 2500 else 1.0)
    scale_y = height if is_norm else (height / max(height, max_val) if max_val > 2500 else 1.0)
    max_step = (width * 0.28) if is_norm else max(width * 0.22, 180.0)

    strokes, curr = [], []
    for i in range(0, len(floats) - 1, 2):
        x, y = floats[i], floats[i + 1]
        if not (math.isfinite(x) and math.isfinite(y)):
            if len(curr) > 1:
                strokes.append({"points": curr, "color": color, "width": stroke_w, "isHighlighter": is_highlighter})
            curr = []
            continue
        x, y = x * scale_x, y * scale_y
        if -60 <= x <= width + 60 and -60 <= y <= height + 60:
            if curr and math.hypot(x - curr[-1][0], y - curr[-1][1]) > max_step:
                if len(curr) > 1:
                    strokes.append({"points": curr, "color": color, "width": stroke_w, "isHighlighter": is_highlighter})
                curr = []
            curr.append((x, y))
        else:
            if len(curr) > 1:
                strokes.append({"points": curr, "color": color, "width": stroke_w, "isHighlighter": is_highlighter})
            curr = []

    if len(curr) > 1:
        strokes.append({"points": curr, "color": color, "width": stroke_w, "isHighlighter": is_highlighter})
    return strokes


def extract_strokes_from_proto(fields: list[dict], width: float = 800.0, height: float = 1000.0, depth: int = 0) -> list[dict]:
    if depth > 6 or not fields:
        return []
    strokes = []
    curr_color = "#1a1a1a"
    curr_width = 2.0
    is_highlighter = False

    for f in fields:
        if f["type"] == "varint":
            if f["fieldNum"] in (3, 4) and f["value"] > 0x00FFFFFF:
                val = f["value"]
                r, g, b = (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF
                curr_color = f"rgb({r},{g},{b})"
            elif f["fieldNum"] == 5 and f["value"] == 3:
                is_highlighter = True
                curr_width = 14.0
        elif f["type"] == "fixed32":
            val = struct.unpack_from("<f", f["value"], 0)[0]
            if math.isfinite(val) and 0.1 < val < 50.0:
                curr_width = val
        elif f["type"] == "bytes":
            byte_data = decompress_apple_bv4(f["value"])
            tpl_strokes = parse_tpl_image(byte_data, width, height)
            if tpl_strokes:
                strokes.extend(tpl_strokes)
                continue
            sub_fields = decode_proto_fields(byte_data)
            if sub_fields:
                sub_strokes = extract_strokes_from_proto(sub_fields, width, height, depth + 1)
                if sub_strokes:
                    strokes.extend(sub_strokes)
                    continue
            fl_strokes = extract_strokes_from_float_buffer(byte_data, width, height, curr_color, curr_width, is_highlighter)
            if fl_strokes:
                strokes.extend(fl_strokes)
    return strokes


def extract_strokes_from_notes_file(notes_bytes: bytes, width: float = 800.0, height: float = 1000.0) -> list[dict]:
    if not notes_bytes:
        return []
    decomp = decompress_apple_bv4(notes_bytes)
    strokes = parse_tpl_image(decomp, width, height)
    if strokes:
        return strokes
    pos = 0
    while pos < len(decomp):
        length, pos = read_varint(decomp, pos)
        if length <= 0 or pos + length > len(decomp):
            break
        fields = decode_proto_fields(decomp[pos:pos + length])
        pos += length
        strokes.extend(extract_strokes_from_proto(fields, width, height))
    if not strokes and len(decomp) >= 32:
        strokes = extract_strokes_from_float_buffer(decomp, width, height)
    return strokes


def strokes_to_svg(strokes: list[dict], width: int = 800, height: int = 1000) -> str:
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">',
        '  <rect width="100%" height="100%" fill="#FFFFFF"/>'
    ]
    for s in strokes:
        pts = s.get("points", [])
        if len(pts) < 2:
            continue
        col = s.get("color", "#1a1a1a")
        sw = s.get("width", 2.0)
        op = 0.38 if s.get("isHighlighter") else 1.0
        d = f"M {pts[0][0]:.2f} {pts[0][1]:.2f}"
        for i in range(1, len(pts) - 1):
            mx = (pts[i][0] + pts[i + 1][0]) / 2.0
            my = (pts[i][1] + pts[i + 1][1]) / 2.0
            d += f" Q {pts[i][0]:.2f} {pts[i][1]:.2f} {mx:.2f} {my:.2f}"
        d += f" L {pts[-1][0]:.2f} {pts[-1][1]:.2f}"
        lines.append(
            f'  <path d="{d}" fill="none" stroke="{col}" stroke-width="{sw:.2f}" '
            f'stroke-linecap="round" stroke-linejoin="round" opacity="{op}"/>'
        )
    lines.append("</svg>")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 3. KOMPLETTES ENTPACKEN & ASSET-/AUDIO-/OCR-EXTRAKTION
# ---------------------------------------------------------------------------
def detect_attachment_type(data: bytes) -> tuple[str, str]:
    """Bestimmt Dateityp und Kategorie anhand der Magic Bytes."""
    if not data or len(data) < 12:
        return (".bin", "other")
    if data[:4] == b"%PDF":
        return (".pdf", "pdfs")
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return (".png", "images")
    if data[:3] == b"\xff\xd8\xff":
        return (".jpg", "images")
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return (".webp", "images")
    if data[4:8] == b"ftyp":
        return (".m4a", "audio")
    if data[:3] == b"ID3" or (data[0] == 0xFF and data[1] in (0xFB, 0xF3, 0xF2, 0xE3)):
        return (".mp3", "audio")
    if data[:4] == b"caff":
        return (".caf", "audio")
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return (".wav", "audio")
    if data[0] == 0xFF and data[1] in (0xF1, 0xF9):
        return (".aac", "audio")
    return (".bin", "other")


def unpack_goodnotes_complete(goodnotes_path: str, output_dir: str) -> dict:
    """
    Entpackt eine .goodnotes-Datei vollständig, stellt PDFs, Bilder, Sprachaufnahmen,
    Seiten-SVGs der Handschrift und den internen OCR-Text wieder her.
    """
    out = Path(output_dir)
    raw_dir = out / "raw"
    assets_dir = out / "assets"
    svg_dir = out / "handwriting_svg"
    for d in (raw_dir, assets_dir, svg_dir):
        d.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(goodnotes_path, "r") as zf:
        zf.extractall(raw_dir)

    result = {"pdfs": [], "images": [], "audio": [], "svgs": [], "ocr_lines": []}

    att_dir = raw_dir / "attachments"
    if att_dir.exists():
        for idx, item in enumerate(sorted(att_dir.iterdir()), start=1):
            if not item.is_file():
                continue
            raw = item.read_bytes()
            ext, cat = detect_attachment_type(raw)
            if cat in result:
                dest = assets_dir / f"attachment_{idx:03d}_{item.name[:8]}{ext}"
                dest.write_bytes(raw)
                result[cat].append(str(dest))

    notes_dir = raw_dir / "notes"
    if notes_dir.exists():
        for idx, nfile in enumerate(sorted(notes_dir.iterdir()), start=1):
            if nfile.is_file() and nfile.stat().st_size > 0:
                strokes = extract_strokes_from_notes_file(nfile.read_bytes())
                if strokes:
                    svg_path = svg_dir / f"page_{idx:03d}_{nfile.name[:8]}.svg"
                    svg_path.write_text(strokes_to_svg(strokes), encoding="utf-8")
                    result["svgs"].append(str(svg_path))

    # OCR-Strings aus *.pb und search/ extrahieren
    uuid_re = re.compile(r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$")
    seen = set()
    pb_files = list(raw_dir.glob("*.pb")) + (list((raw_dir / "search").rglob("*")) if (raw_dir / "search").exists() else [])
    for pbf in pb_files:
        if not pbf.is_file():
            continue
        for chunk in re.findall(rb"[\x20-\x7e\xc3\x80-\xc3\xbf\xe2\x80-\xe2\x8f]{4,}", pbf.read_bytes()):
            try:
                txt = chunk.decode("utf-8").strip()
            except UnicodeDecodeError:
                continue
            if not uuid_re.match(txt) and txt not in seen and not any(k in txt.lower() for k in ("goodnotes", "com.timebase")):
                seen.add(txt)
                result["ocr_lines"].append(txt)

    return result
```

---

### 2.3 Spezialisierte OCR-Strategie für Handschrift (Ink-Only Rendering)
Wenn Handschrift aus `notes/<UUID>` per OCR (z. B. Tesseract oder Vision) in editierbaren Text (Word `.docx`, `.txt` oder Markdown) umgewandelt wird, gelten exakt diese 4 Regeln:
1. **Nur Tinte zeichnen (Ink-Only):** Zeichne ausschließlich die nicht-markierenden Stiftstriche (`isHighlighter == False`) in **Tiefschwarz (`#000000`) auf Reinweiß (`#FFFFFF`)** – **ohne** Karopapier, **ohne** Linien und **ohne** Hintergrund-PDF. Highlighter-Striche werden übersprungen, damit Wörter nicht zu dunklen Balken verschmelzen.
2. **Tight Cropping & 3× Upscaling:** Schneide die Bounding-Box der Tinte mit `30 px` weißem Rand aus und skaliere sie um den Faktor `3×` hoch (bis max. `3200 px`), sodass Buchstaben `25–40 px` groß sind.
3. **Block-Segmentierung (`PSM 6`):** Nutze Page Segmentation Mode `6` (*One uniform block of text*) und `preserve_interword_spaces = 1`.
4. **Rauschfilter:** Verwerfe Zeilen mit weniger als 2 alphanumerischen Zeichen, einem Buchstaben-/Zahlen-Anteil `< 0.55` oder einer Konfidenz `< 35`.

---

## 3. Richtung B (OUTBOUND): `.goodnotes`-Dateien & GoodNotes-Worksheets generieren

Wenn der Nutzer sagt: *„Erstelle mir eine GoodNotes-Datei“*, *„Mach mir daraus ein GoodNotes-Notizbuch“* oder *„Gib mir ein GoodNotes-Arbeitsblatt zum Beschreiben auf dem iPad“*, beherrscht der Agent **zwei Ausgabemodi**:

### Modus 1: Echte `.goodnotes`-Containerdatei generieren (Python-Packer)
Mit dieser Funktion verpackt der Agent jedes generierte PDF-Dokument in eine valide `.goodnotes`-ZIP-Struktur (inkl. `index.notes.pb`, `index.events.pb`, `index.attachments.pb`, `attachments/<UUID>` und vorbereiteten `notes/<PAGE-UUID>`-Ebenen):

```python
import uuid
import zipfile
from pathlib import Path

def encode_varint(val: int) -> bytes:
    out = bytearray()
    while val > 0x7F:
        out.append((val & 0x7F) | 0x80)
        val >>= 7
    out.append(val & 0x7F)
    return bytes(out)

def encode_proto_string(field_num: int, text: str) -> bytes:
    raw = text.encode("utf-8")
    tag = (field_num << 3) | 2  # Wire type 2 (length-delimited)
    return encode_varint(tag) + encode_varint(len(raw)) + raw

def encode_proto_message(fields_bytes: bytes) -> bytes:
    return encode_varint(len(fields_bytes)) + fields_bytes

def build_goodnotes_file_from_pdf(pdf_path: str, output_goodnotes_path: str, page_count: int = 1, thumbnail_jpeg_bytes: bytes | None = None) -> str:
    """
    Verpackt ein PDF-Dokument in eine valide .goodnotes-ZIP-Struktur
    mit attachments/<UUID>, notes/<PAGE-UUID>, index.notes.pb, index.events.pb und index.attachments.pb.
    """
    pdf_bytes = Path(pdf_path).read_bytes()
    pdf_file_uuid = str(uuid.uuid4()).upper()
    logical_att_uuid = str(uuid.uuid4()).upper()
    page_uuids = [str(uuid.uuid4()).upper() for _ in range(max(1, page_count))]

    notes_pb = b"".join(encode_proto_message(encode_proto_string(1, u)) for u in page_uuids)
    events_pb = notes_pb
    att_msg = encode_proto_string(1, logical_att_uuid) + encode_proto_string(2, f"attachments/{pdf_file_uuid}")
    attachments_pb = encode_proto_message(att_msg)

    with zipfile.ZipFile(output_goodnotes_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.notes.pb", notes_pb)
        zf.writestr("index.events.pb", events_pb)
        zf.writestr("index.attachments.pb", attachments_pb)
        zf.writestr(f"attachments/{pdf_file_uuid}", pdf_bytes)
        for p_uuid in page_uuids:
            zf.writestr(f"notes/{p_uuid}", b"")
        if thumbnail_jpeg_bytes:
            zf.writestr("thumbnail.jpg", thumbnail_jpeg_bytes)

    return output_goodnotes_path
```

### Modus 2: Beschreibbare Vektor-PDF-Arbeitsblätter für GoodNotes (mit 5-mm-Karogitter & Hyperlinks)
Für das direkte Beschreiben mit dem Apple Pencil in GoodNotes 5 & 6 erzeugt der Agent Vektor-PDFs (und auf Wunsch parallel die `.goodnotes`-Datei) mit folgenden Spezifikationen:
1. **Exakte GoodNotes-Papiermaße & Original-Farben:**
   - **GoodNotes Standard Portrait:** `595.28 × 771.02 pt` (`210 × 272 mm`) oder **DIN A4:** `595.28 × 841.89 pt` (`210 × 297 mm`).
   - **GoodNotes Classic Cream:** Hintergrund `#FBF8EE`, 5-mm-Karogitter `#DED9C8`, Text `#18181B`.
   - **GoodNotes Dark Paper:** Hintergrund `#1E1E1E`, 5-mm-Karogitter `#333336`, Text `#ECECEC`.
   - **GoodNotes Pure White:** Hintergrund `#FFFFFF`, 5-mm-Karogitter `#E2E8F0`, Text `#18181B`.
2. **Maßstabsgetreues 5-mm-Rechengitter:**
   - Unter jeder Aufgabe wird ein exaktes `5 mm × 5 mm` Karofeld (alternativ Punktraster, Liniert oder Cornell-Layout) gezeichnet, damit der Nutzer direkt auf dem iPad in die Kästchen schreiben und rechnen kann.
3. **Interaktive PDF-Sprunglinks:**
   - Jede Aufgabenseite besitzt oben rechts einen klickbaren PDF-Link (`Zur Musterlösung ->`), der in GoodNotes direkt auf die zugehörige Lösungsseite am Ende des Dokuments springt (und von dort wieder zurück zur Aufgabe).

---

## 4. Verbindlicher Entscheidungsbaum für den KI-Agenten

| Situation / Nutzeranfrage | Aktion des KI-Agenten |
| :--- | :--- |
| **1. Nutzer lädt `*.goodnotes` (oder Backup-`.zip`) hoch** | Entpacke das Archiv sofort mit `unpack_goodnotes_complete()`, lies alle Hintergrund-PDFs und Bilder aus `attachments/`, dekodiere die Handschrift aus `notes/<UUID>` (via `extract_strokes_from_notes_file` + SVG-Rendering + OCR) sowie `index.search.pb`, prüfe die handschriftlichen Lösungen auf Fehler (`KORRIGIERT`) und erstelle das angeforderte Lerndokument. |
| **2. Nutzer möchte `.goodnotes` in PDF, Word (`.docx`), SVG, Bilder oder Audio umwandeln** | Extrahiere die Seitenhintergründe, zeichne auf Wunsch die dekodierten Vektor-Strokes darüber (oder gib das unberührte Original-PDF aus, falls Handschrift deaktiviert ist), wandle Handschrift per Ink-Only-OCR in editierbare `.docx`-Absätze um und stelle eingebettete Sprachaufnahmen (`M4A`/`MP3`/`WAV`/`CAF`) bereit. |
| **3. Nutzer wünscht eine Datei für GoodNotes („Erstelle mir eine GoodNotes-Datei / ein GoodNotes-Worksheet“)** | Erzeuge das Vektor-PDF mit GoodNotes-Papierfarbe (`#FBF8EE` Cream / `#1E1E1E` Dark / `#FFFFFF` White), 5-mm-Rechengitter und klickbaren Lösungslinks und verpacke es zusätzlich mit `build_goodnotes_file_from_pdf()` als `.goodnotes`-Datei. |

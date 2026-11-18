#!/usr/bin/env python3
"""
GoodNotes Desktop Bridge (High-Fidelity Converter)
Optional local helper script for power users who want pixel-perfect vector strokes,
pen pressure ribbons, eraser meshes, and native Apple Vision OCR.

Usage:
    python bridge.py notebook.goodnotes
    python bridge.py backup.zip --format pdf
    python bridge.py library/ --format svg
"""

import os
import sys
import argparse
import zipfile
from pathlib import Path

# Try to import from sibling other/parser-for-goodnotes-main if available
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
PARSER_DIR = PROJECT_ROOT / "other" / "parser-for-goodnotes-main" / "src"

if PARSER_DIR.exists():
    sys.path.insert(0, str(PARSER_DIR))

def convert_single_notebook(gn_path: Path, out_path: Path, output_format: str = "pdf"):
    """Convert a single .goodnotes file using high-fidelity vector parser."""
    print(f"[*] Converting: {gn_path.name} -> {out_path.name}")
    try:
        try:
            import goodnotes_parser
            doc = goodnotes_parser.GoodNotesDocument(str(gn_path))
            if output_format.lower() == "svg":
                doc.export_svg(str(out_path))
            else:
                doc.export_pdf(str(out_path))
            print(f"[+] Successfully converted: {out_path}")
            return True
        except ImportError:
            # Try inkterop CLI or python module if installed
            import subprocess
            cmd = ["inkterop", "convert", str(gn_path), str(out_path)]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0:
                print(f"[+] Successfully converted via inkterop: {out_path}")
                return True
            else:
                raise ImportError("Neither parser-for-goodnotes nor inkterop is installed.")
    except Exception as e:
        print(f"[-] Could not convert {gn_path.name}: {e}")
        print("    Install the high-fidelity tools via: pip install parser-for-goodnotes inkterop")
        print("    Or simply use the browser converter: open index.html")
        return False

def process_archive_or_dir(target_path: Path, output_dir: Path, output_format: str = "pdf"):
    """Walk an archive or directory and convert all discovered .goodnotes files."""
    if not target_path.exists():
        print(f"[-] Target path not found: {target_path}")
        return

    output_dir.mkdir(parents=True, exist_ok=True)

    if target_path.is_file() and target_path.suffix.lower() == ".goodnotes":
        out_file = output_dir / f"{target_path.stem}.{output_format}"
        convert_single_notebook(target_path, out_file, output_format)
    elif target_path.is_file() and target_path.suffix.lower() in [".zip", ".goodnotes.zip"]:
        print(f"[*] Unpacking backup archive: {target_path.name}")
        with zipfile.ZipFile(target_path, "r") as z:
            for member in z.namelist():
                if member.lower().endswith(".goodnotes") and not member.startswith("__MACOSX"):
                    extracted_path = output_dir / "_temp" / member
                    extracted_path.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(member) as src, open(extracted_path, "wb") as dst:
                        dst.write(src.read())

                    rel_pdf = Path(member).with_suffix(f".{output_format}")
                    dest_file = output_dir / rel_pdf
                    dest_file.parent.mkdir(parents=True, exist_ok=True)
                    convert_single_notebook(extracted_path, dest_file, output_format)

                    try:
                        extracted_path.unlink()
                    except OSError:
                        pass
        print(f"[+] Completed archive processing for {target_path.name}")
    elif target_path.is_dir():
        for root, _, files in os.walk(target_path):
            for file in files:
                if file.lower().endswith(".goodnotes"):
                    full_p = Path(root) / file
                    rel = full_p.relative_to(target_path).with_suffix(f".{output_format}")
                    dest_file = output_dir / rel
                    dest_file.parent.mkdir(parents=True, exist_ok=True)
                    convert_single_notebook(full_p, dest_file, output_format)

def main():
    parser = argparse.ArgumentParser(description="GoodNotes Desktop High-Fidelity Converter")
    parser.add_argument("input", help="Path to .goodnotes file, backup .zip, or folder")
    parser.add_argument("-o", "--output", default="./converted_output", help="Output directory")
    parser.add_argument("-f", "--format", choices=["pdf", "svg"], default="pdf", help="Output format")
    args = parser.parse_args()

    process_archive_or_dir(Path(args.input), Path(args.output), args.format)

if __name__ == "__main__":
    main()


/**
 * GoodNotes SVG Vector Exporter
 * Converts extracted vector handwriting strokes and background layers
 * into scalable vector graphics (SVG) and packages them into downloadable ZIPs.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GoodNotesSvgExporter = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Generate an SVG markup string for a single notebook page.
     * @param {Array<object>} strokes - Reconstructed vector strokes
     * @param {number} width - Page width
     * @param {number} height - Page height
     * @param {string|null} [backgroundDataUrl=null] - Optional base64 background image
     * @returns {string} XML SVG string
     */
    function buildPageSvg(strokes, width = 800, height = 1000, backgroundDataUrl = null) {
        const hw = (typeof window !== 'undefined' && window.GoodNotesHandwriting) ? window.GoodNotesHandwriting : null;
        if (hw && typeof hw.renderStrokesToSvg === 'function') {
            return hw.renderStrokesToSvg(strokes, width, height, backgroundDataUrl);
        }

        const w = Math.round(width);
        const h = Math.round(height);
        let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
        svg += `  <rect width="100%" height="100%" fill="#FFFFFF"/>\n`;

        if (backgroundDataUrl) {
            svg += `  <image href="${backgroundDataUrl}" width="${w}" height="${h}"/>\n`;
        }

        if (strokes && strokes.length > 0) {
            for (const stroke of strokes) {
                const pts = stroke.points;
                if (!pts || pts.length === 0) continue;
                const strokeColor = stroke.color || '#1a1a1a';
                const strokeWidth = stroke.width || 2;
                const opacity = stroke.isHighlighter ? (stroke.opacity || 0.38) : (stroke.opacity || 1.0);
                const mixBlend = stroke.isHighlighter ? ' style="mix-blend-mode: multiply;"' : '';

                if (pts.length === 1) {
                    svg += `  <circle cx="${pts[0].x.toFixed(2)}" cy="${pts[0].y.toFixed(2)}" r="${Math.max(0.75, strokeWidth / 2).toFixed(2)}" fill="${strokeColor}" opacity="${opacity}"/>\n`;
                } else if (pts.length === 2) {
                    svg += `  <line x1="${pts[0].x.toFixed(2)}" y1="${pts[0].y.toFixed(2)}" x2="${pts[1].x.toFixed(2)}" y2="${pts[1].y.toFixed(2)}" stroke="${strokeColor}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" opacity="${opacity}"${mixBlend}/>\n`;
                } else {
                    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
                    for (let i = 1; i < pts.length - 1; i++) {
                        const midX = (pts[i].x + pts[i + 1].x) / 2;
                        const midY = (pts[i].y + pts[i + 1].y) / 2;
                        d += ` Q ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
                    }
                    d += ` L ${pts[pts.length - 1].x.toFixed(2)} ${pts[pts.length - 1].y.toFixed(2)}`;
                    svg += `  <path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"${mixBlend}/>\n`;
                }
            }
        }

        svg += `</svg>`;
        return svg;
    }

    /**
     * Package multiple SVG pages of a notebook into a single ZIP archive.
     * @param {Array<{ strokes: Array, width: number, height: number, backgroundDataUrl: string|null }>} pages
     * @param {string} notebookBaseName
     * @param {object} [JSZipClass]
     * @returns {Promise<{ blob: Blob, filename: string, count: number }>}
     */
    async function exportPagesAsSvgZip(pages, notebookBaseName = 'notebook', JSZipClass = null) {
        const ZipCtor = JSZipClass || (typeof window !== 'undefined' ? window.JSZip : null);
        if (!ZipCtor) {
            throw new Error('JSZip library is required to package vector SVG files.');
        }

        const zip = new ZipCtor();
        const total = pages.length;
        const padLen = Math.max(2, String(total).length);

        for (let i = 0; i < total; i++) {
            const page = pages[i];
            const svgContent = buildPageSvg(page.strokes, page.width, page.height, page.backgroundDataUrl);
            const pageNumStr = String(i + 1).padStart(padLen, '0');
            zip.file(`page_${pageNumStr}.svg`, svgContent);
        }

        const cleanBase = notebookBaseName.replace(/\.(goodnotes|pdf|zip)$/i, '');
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        return {
            blob: zipBlob,
            filename: `${cleanBase}_svg.zip`,
            count: total
        };
    }

    return {
        buildPageSvg,
        exportPagesAsSvgZip
    };
}));


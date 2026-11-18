/**
 * GoodNotes Image Exporter
 * Exports rendered notebook pages as high-resolution JPEG/PNG images
 * and packages them into downloadable ZIP bundles.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GoodNotesImageExporter = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Convert an HTML5 Canvas to an image Blob.
     * @param {HTMLCanvasElement} canvas
     * @param {string} [format='image/jpeg']
     * @param {number} [quality=0.94]
     * @returns {Promise<Blob>}
     */
    function canvasToBlob(canvas, format = 'image/jpeg', quality = 0.94) {
        return new Promise((resolve, reject) => {
            if (!canvas) {
                return reject(new Error('Canvas is null or undefined.'));
            }
            if (canvas.toBlob) {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas toBlob returned null.'));
                }, format, quality);
            } else {
                try {
                    const dataUrl = canvas.toDataURL(format, quality);
                    const binStr = atob(dataUrl.split(',')[1]);
                    const len = binStr.length;
                    const arr = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        arr[i] = binStr.charCodeAt(i);
                    }
                    resolve(new Blob([arr], { type: format }));
                } catch (e) {
                    reject(e);
                }
            }
        });
    }

    /**
     * Export all rendered pages of a notebook as a ZIP of JPEG files.
     * @param {Array<{ canvas: HTMLCanvasElement, pageNum: number }>} pages
     * @param {string} notebookBaseName
     * @param {object} [JSZipClass]
     * @returns {Promise<{ blob: Blob, filename: string, count: number }>}
     */
    async function exportPagesAsZip(pages, notebookBaseName = 'notebook', JSZipClass = null) {
        const ZipCtor = JSZipClass || (typeof window !== 'undefined' ? window.JSZip : null);
        if (!ZipCtor) {
            throw new Error('JSZip library is required to bundle page images.');
        }

        const zip = new ZipCtor();
        const total = pages.length;
        const padLen = Math.max(2, String(total).length);

        for (let i = 0; i < total; i++) {
            const page = pages[i];
            if (page.canvas) {
                const blob = await canvasToBlob(page.canvas, 'image/jpeg', 0.94);
                const pageNumStr = String(i + 1).padStart(padLen, '0');
                zip.file(`page_${pageNumStr}.jpg`, blob);
            }
        }

        const cleanBase = notebookBaseName.replace(/\.(goodnotes|pdf|zip)$/i, '');
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        return {
            blob: zipBlob,
            filename: `${cleanBase}_images.zip`,
            count: total
        };
    }

    return {
        canvasToBlob,
        exportPagesAsZip
    };
}));


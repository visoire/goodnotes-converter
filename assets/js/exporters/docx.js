/**
 * GoodNotes Word (.docx) Exporter
 * Builds an editable Word document from converted notebook pages.
 * docx.js is loaded on demand.
 *
 * Each page object may contain:
 *   canvas  - a picture of the page (imported page, or the page with ink as a fallback)
 *   text    - typed text read from the handwriting
 *   note    - a short italic remark (for example: "Handwriting shown as a picture")
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GoodNotesDocxExporter = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DOCX_CDN = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
    const MAX_IMAGE_WIDTH = 640;   // px, fits an A4 page with 0.5in margins
    const MAX_IMAGE_HEIGHT = 880;  // px, leaves room for the page heading
    let loadPromise = null;

    function loadDocxLibrary() {
        if (typeof window !== 'undefined' && window.docx) return Promise.resolve();
        if (loadPromise) return loadPromise;

        loadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = DOCX_CDN;
            script.crossOrigin = 'anonymous';
            script.onload = () => resolve();
            script.onerror = () => {
                loadPromise = null;
                reject(new Error('Could not load the Word builder. Check your internet connection.'));
            };
            document.head.appendChild(script);
        });
        return loadPromise;
    }

    function canvasToBytes(canvas) {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const bin = atob(dataUrl.split(',')[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    /**
     * @param {Array<{ canvas?: HTMLCanvasElement, text?: string, note?: string }>} pages
     * @param {string} notebookTitle
     * @returns {Promise<Blob>}
     */
    async function exportPagesToDocx(pages, notebookTitle = 'Notebook') {
        await loadDocxLibrary();
        const lib = window.docx;
        if (!lib) throw new Error('The Word builder could not be loaded.');

        const { Document, Packer, Paragraph, TextRun, ImageRun, PageBreak, HeadingLevel } = lib;
        const children = [
            new Paragraph({
                text: notebookTitle,
                heading: HeadingLevel.TITLE,
                spacing: { after: 240 }
            })
        ];

        const showPageHeadings = pages.length > 1;

        pages.forEach((page, i) => {
            if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));

            if (showPageHeadings) {
                children.push(new Paragraph({
                    text: `Page ${page.pageNum || i + 1}`,
                    heading: HeadingLevel.HEADING_2,
                    spacing: { before: 120, after: 160 }
                }));
            }

            if (page.canvas) {
                const w = page.canvas.width || 800;
                const h = page.canvas.height || 1000;
                const fit = Math.min(MAX_IMAGE_WIDTH / w, MAX_IMAGE_HEIGHT / h, 1);
                children.push(new Paragraph({
                    children: [new ImageRun({
                        data: canvasToBytes(page.canvas),
                        transformation: { width: Math.round(w * fit), height: Math.round(h * fit) }
                    })],
                    spacing: { after: 160 }
                }));
            }

            if (page.note) {
                children.push(new Paragraph({
                    children: [new TextRun({ text: page.note, italics: true, color: '666666', size: 20 })],
                    spacing: { after: 120 }
                }));
            }

            if (page.text && page.text.trim()) {
                for (const line of page.text.split('\n')) {
                    if (!line.trim()) continue;
                    children.push(new Paragraph({
                        children: [new TextRun({ text: line.trim(), size: 24 })],
                        spacing: { after: 100 }
                    }));
                }
            }
        });

        const doc = new Document({
            creator: 'GoodNotes Converter',
            title: notebookTitle,
            sections: [{
                properties: {
                    page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } }
                },
                children
            }]
        });

        return await Packer.toBlob(doc);
    }

    return { loadDocxLibrary, exportPagesToDocx };
}));

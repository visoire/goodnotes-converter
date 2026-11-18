/**
 * GoodNotes PDF Page Renderer
 * Many notebooks are an imported PDF with pen writing on top. To put the pen
 * writing back onto those pages, or to place the pages inside a Word file,
 * the PDF pages are drawn to canvases here (pdf.js, loaded on demand).
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GoodNotesPdfPages = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    let loadPromise = null;

    function loadPdfJs() {
        if (typeof window !== 'undefined' && window.pdfjsLib) return Promise.resolve();
        if (loadPromise) return loadPromise;

        loadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = PDFJS_URL;
            script.crossOrigin = 'anonymous';
            script.onload = () => resolve();
            script.onerror = () => {
                loadPromise = null;
                reject(new Error('Could not load the PDF page reader. Check your internet connection.'));
            };
            document.head.appendChild(script);
        });
        return loadPromise;
    }

    /**
     * Open a PDF and return a lazy page renderer (one page in memory at a time).
     * @param {Uint8Array} data
     * @returns {Promise<{ numPages: number, renderPage: (index:number, scale:number) => Promise<HTMLCanvasElement>, destroy: Function }>}
     */
    async function openPdf(data) {
        await loadPdfJs();
        const lib = window.pdfjsLib;
        if (!lib) throw new Error('The PDF page reader could not be loaded.');
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

        // pdf.js takes ownership of the buffer it is given, so hand it a copy
        const doc = await lib.getDocument({ data: new Uint8Array(data) }).promise;

        return {
            numPages: doc.numPages,
            async renderPage(index, scale = 1.5) {
                const page = await doc.getPage(index + 1);
                const viewport = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                // "print" intent does not wait for animation frames, so rendering keeps
                // going even if the person switches to another browser tab meanwhile.
                await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
                page.cleanup();
                return canvas;
            },
            destroy() {
                try { doc.destroy(); } catch (e) { /* already closed */ }
            }
        };
    }

    return { openPdf };
}));

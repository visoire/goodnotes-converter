/**
 * GoodNotes Handwriting Reader
 * Turns the pen strokes of a page into typed text, fully in the browser.
 *
 * How it works (and why it is built this way):
 *  1. Only the ink is drawn: black on white, no page template, no imported PDF
 *     content. OCR engines read handwriting far better without lines and slides behind it.
 *  2. The ink is cropped to the written area and scaled up so letters are large enough to read.
 *  3. Tesseract.js (loaded on demand, runs locally) reads it as one block of text.
 *  4. Low-confidence and garbage lines are dropped so the Word file stays readable.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GoodNotesOCR = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    const TARGET_SCALE = 3;        // enlarge ink so letters are ~25-40px tall
    const MAX_CANVAS_DIM = 3200;   // keep memory and OCR time reasonable
    const CROP_MARGIN = 30;        // white border around the written area
    const MIN_LINE_CONFIDENCE = 35;
    const MIN_ALNUM_RATIO = 0.55;

    let workerPromise = null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (typeof window === 'undefined') {
                return reject(new Error('Handwriting reading needs a browser.'));
            }
            if (window.Tesseract) return resolve();
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', () => reject(new Error('Could not load the handwriting reader. Check your internet connection.')));
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.crossOrigin = 'anonymous';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Could not load the handwriting reader. Check your internet connection.'));
            document.head.appendChild(script);
        });
    }

    async function getWorker(onStatus) {
        if (workerPromise) return workerPromise;

        workerPromise = (async () => {
            if (!window.Tesseract) {
                if (onStatus) onStatus('Loading the handwriting reader...');
                await loadScript(TESSERACT_CDN);
            }
            if (!window.Tesseract) throw new Error('The handwriting reader could not be loaded.');

            if (onStatus) onStatus('Preparing the handwriting reader...');
            const worker = await window.Tesseract.createWorker('eng', 1, {});
            // 6 = "one uniform block of text". Handwriting is often mistaken for a
            // picture by automatic layout detection, so we force text mode.
            await worker.setParameters({
                tessedit_pageseg_mode: '6',
                preserve_interword_spaces: '1'
            });
            return worker;
        })();

        // If loading fails, allow a retry on the next call instead of caching the failure
        workerPromise.catch(() => { workerPromise = null; });
        return workerPromise;
    }

    async function terminate() {
        if (!workerPromise) return;
        try {
            const worker = await workerPromise;
            await worker.terminate();
        } catch (e) { /* nothing to clean up */ }
        workerPromise = null;
    }

    /**
     * Draw only the ink, black on white, cropped and enlarged for OCR.
     * Highlighter strokes are skipped: they would turn words into solid blobs.
     * @returns {HTMLCanvasElement|null}
     */
    function buildInkCanvas(strokes) {
        const hw = window.GoodNotesHandwriting;
        if (!hw || !strokes) return null;

        const usable = strokes.filter(s => !s.isHighlighter && s.points && s.points.length > 1);
        if (usable.length === 0) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of usable) {
            for (const p of s.points) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
        }
        if (!isFinite(minX) || !isFinite(minY)) return null;

        const boxW = Math.max(1, maxX - minX) + CROP_MARGIN * 2;
        const boxH = Math.max(1, maxY - minY) + CROP_MARGIN * 2;
        const scale = Math.max(1, Math.min(TARGET_SCALE, MAX_CANVAS_DIM / Math.max(boxW, boxH)));

        const scaled = usable.map(s => ({
            points: s.points.map(p => ({
                x: (p.x - minX + CROP_MARGIN) * scale,
                y: (p.y - minY + CROP_MARGIN) * scale
            })),
            color: '#000000',
            width: Math.max(3, (s.width || 2) * scale * 0.8),
            opacity: 1,
            isHighlighter: false
        }));

        return hw.renderStrokesToCanvas(scaled, Math.ceil(boxW * scale), Math.ceil(boxH * scale), null, {});
    }

    /**
     * Keep only lines that look like real words.
     * @returns {{ text: string, confidence: number }}
     */
    function cleanRecognizedText(data) {
        let lines;
        if (data && Array.isArray(data.lines) && data.lines.length > 0) {
            lines = data.lines.map(l => ({ text: (l.text || '').trim(), conf: l.confidence }));
        } else {
            const fallbackConf = (data && data.confidence) || 0;
            lines = ((data && data.text) || '').split('\n').map(t => ({ text: t.trim(), conf: fallbackConf }));
        }

        const kept = [];
        for (const line of lines) {
            const text = line.text.replace(/\s+/g, ' ');
            if (!text) continue;
            const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
            const ratio = letters / text.length;
            if (letters < 2) continue;
            if (ratio < MIN_ALNUM_RATIO) continue;
            if (typeof line.conf === 'number' && line.conf < MIN_LINE_CONFIDENCE) continue;
            kept.push({ text, conf: typeof line.conf === 'number' ? line.conf : 0 });
        }

        const confidence = kept.length
            ? Math.round(kept.reduce((sum, l) => sum + l.conf, 0) / kept.length)
            : 0;
        return { text: kept.map(l => l.text).join('\n'), confidence };
    }

    /**
     * Read the handwriting of every page that has ink. Sets page.text on each page.
     * @param {Array<{strokes: Array}>} pages
     * @param {Function} [onProgress] - (doneCount, total, message)
     * @returns {Promise<{ pagesWithInk: number, pagesWithText: number }>}
     */
    async function recognizeHandwriting(pages, onProgress) {
        const inkPages = (pages || []).filter(p => p.strokes && p.strokes.length > 0);
        const stats = { pagesWithInk: inkPages.length, pagesWithText: 0 };
        if (inkPages.length === 0) return stats;

        const worker = await getWorker(msg => onProgress && onProgress(0, inkPages.length, msg));

        for (let i = 0; i < inkPages.length; i++) {
            const page = inkPages[i];
            page.text = '';
            if (onProgress) onProgress(i, inkPages.length, `Reading handwriting, page ${i + 1} of ${inkPages.length}...`);

            try {
                const inkCanvas = buildInkCanvas(page.strokes);
                if (!inkCanvas) continue;
                const { data } = await worker.recognize(inkCanvas);
                const cleaned = cleanRecognizedText(data);
                page.text = cleaned.text;
                page.textConfidence = cleaned.confidence;
                if (cleaned.text) stats.pagesWithText++;
            } catch (e) {
                console.warn(`[Handwriting] Could not read page ${page.pageNum}:`, e);
            }
        }

        if (onProgress) onProgress(inkPages.length, inkPages.length, 'Handwriting read.');
        return stats;
    }

    /**
     * Plain-text file of the handwriting, page by page (pages with ink only).
     * Call after recognizeHandwriting.
     */
    function formatTranscript(pages, title = 'Notebook') {
        let out = `${title}\n\n`;
        for (const page of pages) {
            if (!page.strokes || page.strokes.length === 0) continue;
            out += `--- Page ${page.pageNum} ---\n`;
            out += (page.text && page.text.trim()) ? page.text.trim() : '(handwriting could not be read on this page)';
            out += '\n\n';
        }
        return out;
    }

    return {
        formatTranscript,
        recognizeHandwriting,
        buildInkCanvas,
        cleanRecognizedText,
        terminate
    };
}));

/**
 * GoodNotes ZIP & Backup Handler
 * Finds the notebooks inside an archive and packs the converted files back
 * into one download, keeping the original folder structure.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GoodNotesZipHandler = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Inspect a loaded JSZip archive to discover all contained notebooks and folder paths.
     * @param {JSZip} rootZip
     * @returns {object} { isDirectNotebook, hasThumbnail, innerGoodNotesEntries, subfolderNotebookMap }
     */
    function inspectArchive(rootZip) {
        let isDirectNotebook = false;
        let hasThumbnail = false;
        const innerGoodNotesEntries = [];
        const subfolderNotebookMap = new Map();

        rootZip.forEach((relPath, entry) => {
            if (entry.dir) return;

            if (relPath.toLowerCase() === 'thumbnail.jpg') hasThumbnail = true;

            // Notebook files at the archive root
            if (relPath.startsWith('attachments/') || relPath.startsWith('notes/') ||
                relPath === 'index.events.pb' || relPath === 'index.notes.pb' || relPath === 'schema.pb') {
                isDirectNotebook = true;
            }

            // Notebooks packed inside the archive
            if (relPath.toLowerCase().endsWith('.goodnotes')) {
                innerGoodNotesEntries.push({ path: relPath, entry });
            }

            // Unpacked notebook folders inside the archive
            const parts = relPath.split('/');
            if (parts.length > 2 && (parts[1] === 'attachments' || parts[1] === 'notes' || parts[1].startsWith('index.'))) {
                const folder = parts[0];
                if (!subfolderNotebookMap.has(folder)) subfolderNotebookMap.set(folder, []);
                subfolderNotebookMap.get(folder).push({ path: relPath, entry });
            }
        });

        return { isDirectNotebook, hasThumbnail, innerGoodNotesEntries, subfolderNotebookMap };
    }

    /**
     * Read thumbnail.jpg from a notebook if it has one.
     * @param {JSZip} zip
     * @returns {Promise<Uint8Array|null>}
     */
    async function extractThumbnail(zip) {
        if (!zip) return null;
        const thumbFile = zip.file('thumbnail.jpg') || zip.file('Thumbnail.jpg') || zip.file('thumbnail.jpeg');
        if (thumbFile) {
            try {
                return await thumbFile.async('uint8array');
            } catch (e) {
                console.warn('[ZipHandler] Could not read thumbnail.jpg:', e);
            }
        }
        return null;
    }

    /**
     * Pack every converted file (PDF or Word, plus any voice recordings) into one ZIP.
     * @param {Array<object>} convertedFiles
     * @returns {Promise<Blob>}
     */
    async function buildMasterZip(convertedFiles) {
        const ZipCtor = typeof window !== 'undefined' ? window.JSZip : null;
        if (!ZipCtor) throw new Error('JSZip is required to build the ZIP.');

        const masterZip = new ZipCtor();

        for (const item of convertedFiles) {
            if (!item || item.error) continue;

            if (item.blob) {
                masterZip.file(item.relativePath, item.blob);
            }

            const basePath = item.relativePath.replace(/\.(pdf|docx)$/i, '');

            if (item.imagesZipBlob) masterZip.file(`${basePath}_pages.zip`, item.imagesZipBlob);
            if (item.svgZipBlob) masterZip.file(`${basePath}_vector.zip`, item.svgZipBlob);
            if (item.transcriptText) masterZip.file(`${basePath}.txt`, item.transcriptText);

            if (item.audioList && item.audioList.length > 0) {
                for (const audio of item.audioList) {
                    masterZip.file(`${basePath}_recordings/${audio.filename}`, audio.data);
                }
            }
        }

        return await masterZip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
    }

    return { inspectArchive, extractThumbnail, buildMasterZip };
}));

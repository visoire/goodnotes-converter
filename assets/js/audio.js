/**
 * GoodNotes Audio Extractor Module
 * Detects, sniffs, and extracts embedded audio recordings (voice memos, lecture recordings)
 * from GoodNotes attachments with magic header inspection (M4A, MP3, WAV, AAC, CAF).
 * Adapted and enhanced from goodnotes-extractor.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GoodNotesAudio = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Magic byte inspection to detect audio format.
     * @param {Uint8Array} bytes
     * @returns {string|null} Audio extension ('m4a', 'mp3', 'wav', 'aac', 'caf') or null
     */
    function detectAudioType(bytes) {
        if (!bytes || bytes.length < 12) return null;

        // 1. M4A / MP4 container (ISO Base Media File Format)
        // Offset 4..7 contains 'ftyp' (0x66, 0x74, 0x79, 0x70)
        if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
            return 'm4a';
        }

        // 2. MP3 with ID3 tag: 'ID3' (0x49, 0x44, 0x33)
        if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
            return 'mp3';
        }

        // 3. MP3 raw sync word: 11 set bits (0xFF followed by 0xFB, 0xF3, 0xF2, 0xE3)
        if (bytes[0] === 0xFF && (bytes[1] === 0xFB || bytes[1] === 0xF3 || bytes[1] === 0xF2 || bytes[1] === 0xE3)) {
            return 'mp3';
        }

        // 4. Apple Core Audio Format: 'caff' (0x63, 0x61, 0x66, 0x66)
        if (bytes[0] === 0x63 && bytes[1] === 0x61 && bytes[2] === 0x66 && bytes[3] === 0x66) {
            return 'caf';
        }

        // 5. RIFF WAV: 'RIFF' at 0..3 and 'WAVE' at 8..11
        if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
            return 'wav';
        }

        // 6. AAC raw ADTS header (0xFFF)
        if (bytes[0] === 0xFF && (bytes[1] === 0xF1 || bytes[1] === 0xF9)) {
            return 'aac';
        }

        return null;
    }

    /**
     * Inspect all attachment files in a JSZip instance to discover audio recordings.
     * @param {JSZip} zip - Loaded JSZip notebook archive
     * @returns {Promise<Array<{ entry: object, filename: string, ext: string, size: number, blob: Blob, data: Uint8Array }>>}
     */
    async function extractAudioRecordings(zip) {
        if (!zip) return [];

        const candidates = [];
        zip.forEach((path, entry) => {
            const lower = path.toLowerCase();
            if (!entry.dir && (lower.includes('attachments/') || lower.includes('audio/'))) {
                candidates.push({ path, entry });
            }
        });

        const audioList = [];

        for (const item of candidates) {
            try {
                const data = await item.entry.async('uint8array');
                const audioExt = detectAudioType(data);

                if (audioExt) {
                    const mimeType = audioExt === 'mp3' ? 'audio/mpeg'
                                   : audioExt === 'm4a' ? 'audio/mp4'
                                   : audioExt === 'wav' ? 'audio/wav'
                                   : 'audio/' + audioExt;

                    const blob = new Blob([data], { type: mimeType });
                    audioList.push({
                        entry: item.entry,
                        originalPath: item.path,
                        ext: audioExt,
                        mimeType: mimeType,
                        size: data.length,
                        data: data,
                        blob: blob
                    });
                }
            } catch (err) {
                console.warn('[AudioExtractor] Error inspecting entry:', item.path, err);
            }
        }

        // Sort largest first (GoodNotes primary lecture recordings are largest attachments)
        audioList.sort((a, b) => b.size - a.size);

        // Assign clean sequential names
        audioList.forEach((audioItem, idx) => {
            audioItem.filename = `recording_${idx + 1}.${audioItem.ext}`;
        });

        return audioList;
    }

    /**
     * Package multiple audio files of a notebook into a single ZIP archive.
     * @param {Array<object>} audioList
     * @param {string} notebookBaseName
     * @param {object} [JSZipClass]
     * @returns {Promise<{ blob: Blob, filename: string, count: number }>}
     */
    async function packageAudioAsZip(audioList, notebookBaseName = 'notebook', JSZipClass = null) {
        const ZipCtor = JSZipClass || (typeof window !== 'undefined' ? window.JSZip : null);
        if (!ZipCtor) {
            throw new Error('JSZip library is required to bundle audio recordings.');
        }

        const zip = new ZipCtor();
        for (const item of audioList) {
            zip.file(item.filename, item.data);
        }

        const cleanBase = notebookBaseName.replace(/\.(goodnotes|pdf|zip)$/i, '');
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 4 }
        });

        return {
            blob: zipBlob,
            filename: `${cleanBase}_audio.zip`,
            count: audioList.length
        };
    }

    return {
        detectAudioType,
        extractAudioRecordings,
        packageAudioAsZip
    };
}));

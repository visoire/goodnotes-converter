/**
 * GoodNotes Handwritten Content Extractor & Vector Stroke Renderer
 * 
 * IMPORTANT:
 * Handwritten content may not convert perfectly.
 * GoodNotes stores vector strokes, pressure dynamics, pen shaders, and eraser meshes
 * in proprietary binary structures (Protobuf + Apple Framed LZ4 + Troy Hanson TPL).
 * This module extracts and reconstructs stroke geometry and renders it onto HTML5 Canvas.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GoodNotesHandwriting = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Read varint from byte array with safety bounds.
     * @param {Uint8Array} data
     * @param {number} pos
     * @returns {[number, number]} [decodedValue, nextPos]
     */
    function readVarint(data, pos) {
        let result = 0, shift = 0;
        while (pos < data.length) {
            const b = data[pos];
            result |= (b & 0x7f) << shift;
            pos++;
            if ((b & 0x80) === 0) break;
            shift += 7;
            if (shift > 35) break; // Safety cutoff against malformed varints
        }
        return [result >>> 0, pos];
    }

    /**
     * Decode protobuf fields into structured field tokens.
     * @param {Uint8Array} data
     * @param {number} start
     * @param {number} end
     * @returns {Array<object>}
     */
    function decodeProtoFields(data, start, end) {
        const fields = [];
        let pos = start;
        while (pos < end) {
            let tag, fieldNum, wireType;
            [tag, pos] = readVarint(data, pos);
            fieldNum = tag >>> 3;
            wireType = tag & 0x7;
            if (fieldNum === 0) break;

            if (wireType === 0) { // Varint
                let val;
                [val, pos] = readVarint(data, pos);
                fields.push({ fieldNum, type: 'varint', value: val });
            } else if (wireType === 1) { // 64-bit fixed
                if (pos + 8 > end) break;
                const val = data.slice(pos, pos + 8);
                pos += 8;
                fields.push({ fieldNum, type: 'fixed64', value: val });
            } else if (wireType === 2) { // Length-delimited bytes / message / string
                let len;
                [len, pos] = readVarint(data, pos);
                if (pos + len > end || len < 0) break;
                const val = data.slice(pos, pos + len);
                pos += len;
                fields.push({ fieldNum, type: 'bytes', value: val });
            } else if (wireType === 5) { // 32-bit fixed
                if (pos + 4 > end) break;
                const val = data.slice(pos, pos + 4);
                pos += 4;
                fields.push({ fieldNum, type: 'fixed32', value: val });
            } else {
                // Unsupported wire type or corrupt stream
                break;
            }
        }
        return fields;
    }

    /**
     * Decode a stream of length-delimited protobuf messages.
     * @param {Uint8Array} uint8
     * @returns {Array<Array<object>>}
     */
    function decodeProtoStream(uint8) {
        if (!uint8 || uint8.length === 0) return [];
        const messages = [];
        let pos = 0;
        while (pos < uint8.length) {
            let len;
            [len, pos] = readVarint(uint8, pos);
            if (pos + len > uint8.length || len <= 0) break;
            const msgData = uint8.subarray(pos, pos + len);
            pos += len;
            try {
                messages.push(decodeProtoFields(msgData, 0, msgData.length));
            } catch (err) {
                console.warn('[Handwriting] Proto stream decode notice:', err);
                break;
            }
        }
        return messages;
    }

    /**
     * Safely attempt UTF-8 string decoding from bytes.
     * @param {Uint8Array} bytes
     * @returns {string|null}
     */
    function tryDecodeString(bytes) {
        if (!bytes || bytes.length === 0) return null;
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
            return null;
        }
    }

    /**
     * Extract ordered attachment UUIDs from index.events.pb or index.notes.pb.
     * @param {Uint8Array} pbData
     * @returns {Array<string>} List of unique uppercase UUIDs in discovery order
     */
    function extractAttachmentOrderFromEvents(pbData) {
        if (!pbData || pbData.length === 0) return [];
        const uuidPattern = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;
        const text = new TextDecoder('utf-8', { fatal: false }).decode(pbData);
        const matches = text.match(uuidPattern) || [];
        const seen = new Set();
        const ordered = [];
        for (const uuid of matches) {
            const upper = uuid.toUpperCase();
            if (!seen.has(upper)) {
                seen.add(upper);
                ordered.push(upper);
            }
        }
        return ordered;
    }

    /**
     * Decompress a raw LZ4 block with sliding history dictionary support.
     * @param {Uint8Array} src - Compressed LZ4 block data
     * @param {number} uncompressedSize - Expected uncompressed size in bytes
     * @param {Uint8Array|null} dictBuffer - Preceding sliding dictionary buffer
     * @returns {Uint8Array} Decompressed bytes
     */
    function decompressLz4Block(src, uncompressedSize, dictBuffer) {
        if (uncompressedSize <= 0 || uncompressedSize > 50 * 1024 * 1024) {
            throw new Error(`Invalid uncompressed size: ${uncompressedSize}`);
        }
        const dst = new Uint8Array(uncompressedSize);
        let srcPos = 0;
        let dstPos = 0;
        const dictLen = dictBuffer ? dictBuffer.length : 0;

        while (srcPos < src.length && dstPos < uncompressedSize) {
            const token = src[srcPos++];
            let literalLen = token >>> 4;
            if (literalLen === 15) {
                let b;
                do {
                    if (srcPos >= src.length) break;
                    b = src[srcPos++];
                    literalLen += b;
                } while (b === 255 && srcPos < src.length);
            }

            // Copy literal bytes
            for (let i = 0; i < literalLen && dstPos < uncompressedSize && srcPos < src.length; i++) {
                dst[dstPos++] = src[srcPos++];
            }

            if (dstPos >= uncompressedSize || srcPos >= src.length) {
                break;
            }

            // Read 16-bit match offset (little-endian)
            if (srcPos + 2 > src.length) break;
            const offset = src[srcPos] | (src[srcPos + 1] << 8);
            srcPos += 2;
            if (offset === 0) break; // Invalid offset in LZ4 specification

            let matchLen = token & 0x0f;
            if (matchLen === 15) {
                let b;
                do {
                    if (srcPos >= src.length) break;
                    b = src[srcPos++];
                    matchLen += b;
                } while (b === 255 && srcPos < src.length);
            }
            matchLen += 4; // Minimum match length is 4

            // Copy match bytes with backward reference
            for (let i = 0; i < matchLen && dstPos < uncompressedSize; i++) {
                const matchIndex = dstPos - offset;
                if (matchIndex >= 0) {
                    dst[dstPos++] = dst[matchIndex];
                } else if (dictBuffer && (matchIndex + dictLen) >= 0) {
                    dst[dstPos++] = dictBuffer[matchIndex + dictLen];
                } else {
                    dst[dstPos++] = 0;
                }
            }
        }
        return dst;
    }

    /**
     * Decompress Apple Framed LZ4 stream (bv41 compressed, bv4- uncompressed, bv4$ terminator).
     * @param {Uint8Array} data - Binary data potentially wrapped in Apple LZ4 framing
     * @returns {Uint8Array} Decompressed or original payload
     */
    function decompressAppleBv4(data) {
        if (!data || data.length < 8) return data;

        // Check if data starts with bv41 or bv4-
        const isBv4Start = data[0] === 0x62 && data[1] === 0x76 && data[2] === 0x34 &&
            (data[3] === 0x31 || data[3] === 0x2D);

        let startPos = 0;
        if (!isBv4Start) {
            let found = -1;
            // Scan for embedded bv41 or bv4- marker
            for (let i = 0; i <= data.length - 8; i++) {
                if (data[i] === 0x62 && data[i+1] === 0x76 && data[i+2] === 0x34 &&
                    (data[i+3] === 0x31 || data[i+3] === 0x2D)) {
                    found = i;
                    break;
                }
            }
            if (found === -1) return data; // Not Apple Framed LZ4
            startPos = found;
        }

        let pos = startPos;
        const chunks = [];
        let totalLen = 0;
        const maxTotalDecompressed = 80 * 1024 * 1024; // 80 MB safety ceiling
        const slidingDict = new Uint8Array(65536);
        let dictLen = 0;

        while (pos + 4 <= data.length) {
            const h0 = data[pos], h1 = data[pos+1], h2 = data[pos+2], h3 = data[pos+3];

            // 'bv4$' terminator
            if (h0 === 0x62 && h1 === 0x76 && h2 === 0x34 && h3 === 0x24) {
                pos += 4;
                break;
            }

            // 'bv4-' uncompressed chunk
            if (h0 === 0x62 && h1 === 0x76 && h2 === 0x34 && h3 === 0x2D) {
                pos += 4;
                if (pos + 4 > data.length) break;
                const uncompressedSize = (data[pos] | (data[pos+1] << 8) | (data[pos+2] << 16) | (data[pos+3] << 24)) >>> 0;
                pos += 4;
                if (uncompressedSize === 0 || pos + uncompressedSize > data.length || totalLen + uncompressedSize > maxTotalDecompressed) {
                    break;
                }
                const chunk = data.subarray(pos, pos + uncompressedSize);
                pos += uncompressedSize;
                chunks.push(chunk);
                totalLen += chunk.length;

                // Update sliding dictionary buffer
                const toCopy = Math.min(chunk.length, 65536);
                slidingDict.set(chunk.subarray(chunk.length - toCopy), 65536 - toCopy);
                dictLen = Math.min(65536, dictLen + chunk.length);

            // 'bv41' compressed chunk
            } else if (h0 === 0x62 && h1 === 0x76 && h2 === 0x34 && h3 === 0x31) {
                pos += 4;
                if (pos + 8 > data.length) break;
                const uncompressedSize = (data[pos] | (data[pos+1] << 8) | (data[pos+2] << 16) | (data[pos+3] << 24)) >>> 0;
                const compressedSize = (data[pos+4] | (data[pos+5] << 8) | (data[pos+6] << 16) | (data[pos+7] << 24)) >>> 0;
                pos += 8;

                if (uncompressedSize === 0 || compressedSize === 0 || pos + compressedSize > data.length || totalLen + uncompressedSize > maxTotalDecompressed) {
                    break;
                }

                const compData = data.subarray(pos, pos + compressedSize);
                pos += compressedSize;

                try {
                    const decompressed = decompressLz4Block(
                        compData,
                        uncompressedSize,
                        dictLen > 0 ? slidingDict.subarray(65536 - dictLen) : null
                    );
                    chunks.push(decompressed);
                    totalLen += decompressed.length;
                    const toCopy = Math.min(decompressed.length, 65536);
                    slidingDict.set(decompressed.subarray(decompressed.length - toCopy), 65536 - toCopy);
                    dictLen = Math.min(65536, dictLen + decompressed.length);
                } catch (e) {
                    console.warn('[Handwriting] LZ4 chunk decode notice:', e);
                    break;
                }
            } else {
                break;
            }
        }

        if (chunks.length === 0) return data;

        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
            result.set(c, offset);
            offset += c.length;
        }
        return result;
    }

    /**
     * Parse Troy Hanson TPL serialized image structures with stroke segmentation.
     * @param {Uint8Array} data
     * @param {number} targetWidth
     * @param {number} targetHeight
     * @returns {object|null}
     */
    function parseTplImage(data, targetWidth = 800, targetHeight = 1000) {
        if (!data || data.length < 8) return null;
        let tplOffset = -1;
        for (let i = 0; i <= data.length - 4; i++) {
            if (data[i] === 0x74 && data[i+1] === 0x70 && data[i+2] === 0x6C) {
                tplOffset = i;
                break;
            }
        }
        if (tplOffset === -1) return null;

        let pos = tplOffset + 3;
        pos++; // flags byte
        if (pos + 4 > data.length) return null;
        pos += 4; // length field

        // Read null-terminated format string
        let fmt = '';
        while (pos < data.length && data[pos] !== 0 && fmt.length < 64) {
            fmt += String.fromCharCode(data[pos++]);
        }
        if (pos < data.length && data[pos] === 0) pos++;

        const strokes = [];
        if (fmt.includes('A(')) {
            if (pos + 4 <= data.length) {
                const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
                let count = dv.getUint32(pos, true);
                pos += 4;

                // Safety cap to avoid freezing browser on corrupted records
                count = Math.min(count, 50000);

                const isFff = fmt.includes('fff');
                const floatsPerItem = isFff ? 3 : 2;
                let currentPoints = [];
                const maxStepDist = Math.max(targetWidth * 0.22, 160);

                for (let i = 0; i < count && pos + floatsPerItem * 4 <= data.length; i++) {
                    const x = dv.getFloat32(pos, true);
                    const y = dv.getFloat32(pos + 4, true);
                    const p = isFff ? dv.getFloat32(pos + 8, true) : 1.0;
                    pos += floatsPerItem * 4;

                    if (!isFinite(x) || !isFinite(y)) {
                        if (currentPoints.length > 1) {
                            strokes.push({ points: currentPoints, width: 2, color: '#1a1a1a' });
                        }
                        currentPoints = [];
                        continue;
                    }

                    // Pen lift detection: either near-zero pressure or sudden large coordinate jump
                    if (currentPoints.length > 0) {
                        const last = currentPoints[currentPoints.length - 1];
                        const dist = Math.hypot(x - last.x, y - last.y);
                        if (dist > maxStepDist || (isFff && p <= 0.001)) {
                            if (currentPoints.length > 1) {
                                strokes.push({ points: currentPoints, width: 2, color: '#1a1a1a' });
                            }
                            currentPoints = [];
                        }
                    }

                    currentPoints.push({ x, y, pressure: p });
                }

                if (currentPoints.length > 1) {
                    strokes.push({ points: currentPoints, width: 2, color: '#1a1a1a' });
                }
            }
        }
        return { format: fmt, strokes };
    }

    /**
     * Heuristically extract stroke points from a sequence of IEEE-754 32-bit floats.
     * Uses continuity and bounding box heuristics to distinguish true strokes from noise.
     * @param {Uint8Array} buffer
     * @param {number} targetWidth
     * @param {number} targetHeight
     * @param {object} strokeMeta
     * @returns {Array<object>} Array of stroke objects
     */
    function extractStrokesFromFloatBuffer(buffer, targetWidth, targetHeight, strokeMeta = {}) {
        if (!buffer || buffer.length < 24) return [];
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const floatCount = Math.floor(buffer.length / 4);
        if (floatCount < 6) return [];

        const floats = [];
        for (let i = 0; i < floatCount; i++) {
            floats.push(view.getFloat32(i * 4, true));
        }

        // Test coordinate range and plausibility
        let validCoords = 0;
        let finiteCount = 0;
        let maxVal = 0;
        let minVal = 0;

        for (let i = 0; i < Math.min(floats.length - 1, 40); i += 2) {
            const x = floats[i];
            const y = floats[i+1];
            if (isFinite(x) && isFinite(y)) {
                finiteCount++;
                maxVal = Math.max(maxVal, x, y);
                minVal = Math.min(minVal, x, y);
                if (x >= -0.05 && x <= 1.05 && y >= -0.05 && y <= 1.05) {
                    validCoords++;
                }
            }
        }

        // Determine if coordinates are normalized [0.0 .. 1.0]
        const isNormalized = finiteCount >= 4 && (validCoords / finiteCount >= 0.7);

        // Determine coordinate scale factor
        const w = targetWidth || 800;
        const h = targetHeight || 1000;
        let scaleX = 1.0;
        let scaleY = 1.0;

        if (isNormalized) {
            scaleX = w;
            scaleY = h;
        } else if (maxVal > 2500) {
            // Retina or high-res point scale (e.g. GoodNotes 2x/3x canvas)
            scaleX = w / Math.max(w, maxVal);
            scaleY = h / Math.max(h, maxVal);
        }

        const strokes = [];
        let currentPts = [];
        const maxStepDist = isNormalized ? (w * 0.28) : Math.max(w * 0.22, 180);
        const maxStrokesLimit = 3000;
        const maxPointsLimit = 40000;
        let totalPoints = 0;

        for (let i = 0; i < floats.length - 1; i += 2) {
            if (strokes.length >= maxStrokesLimit || totalPoints >= maxPointsLimit) {
                break;
            }

            let x = floats[i];
            let y = floats[i+1];

            if (!isFinite(x) || !isFinite(y)) {
                if (currentPts.length > 1) {
                    strokes.push({
                        points: currentPts,
                        color: strokeMeta.color || '#1a1a1a',
                        width: strokeMeta.width || 2,
                        opacity: strokeMeta.opacity || 1.0,
                        isHighlighter: strokeMeta.isHighlighter || false
                    });
                }
                currentPts = [];
                continue;
            }

            x = x * scaleX;
            y = y * scaleY;

            // Page bounds validation: must be within reasonable margin of canvas
            if (x >= -60 && x <= w + 60 && y >= -60 && y <= h + 60) {
                if (currentPts.length > 0) {
                    const last = currentPts[currentPts.length - 1];
                    const dist = Math.hypot(x - last.x, y - last.y);
                    if (dist > maxStepDist) {
                        // Pen lift detected
                        if (currentPts.length > 1) {
                            strokes.push({
                                points: currentPts,
                                color: strokeMeta.color || '#1a1a1a',
                                width: strokeMeta.width || 2,
                                opacity: strokeMeta.opacity || 1.0,
                                isHighlighter: strokeMeta.isHighlighter || false
                            });
                        }
                        currentPts = [];
                    }
                }
                currentPts.push({ x, y });
                totalPoints++;
            } else {
                if (currentPts.length > 1) {
                    strokes.push({
                        points: currentPts,
                        color: strokeMeta.color || '#1a1a1a',
                        width: strokeMeta.width || 2,
                        opacity: strokeMeta.opacity || 1.0,
                        isHighlighter: strokeMeta.isHighlighter || false
                    });
                }
                currentPts = [];
            }
        }

        if (currentPts.length > 1 && strokes.length < maxStrokesLimit) {
            strokes.push({
                points: currentPts,
                color: strokeMeta.color || '#1a1a1a',
                width: strokeMeta.width || 2,
                opacity: strokeMeta.opacity || 1.0,
                isHighlighter: strokeMeta.isHighlighter || false
            });
        }

        return strokes;
    }

    /**
     * Recursively extract strokes from protobuf fields and nested payloads.
     * @param {Array<object>} fields
     * @param {number} targetWidth
     * @param {number} targetHeight
     * @param {number} depth
     * @returns {Array<object>}
     */
    function extractStrokesFromProto(fields, targetWidth, targetHeight, depth = 0) {
        if (depth > 6 || !fields) return [];
        let strokes = [];
        let currentColor = '#1a1a1a';
        let currentWidth = 2;
        let isHighlighter = false;

        for (const f of fields) {
            if (f.type === 'varint') {
                // Color or pen attributes
                if (f.fieldNum === 3 || f.fieldNum === 4) {
                    const val = f.value;
                    if (val > 0x00FFFFFF) {
                        const r = (val >> 16) & 0xFF;
                        const g = (val >> 8) & 0xFF;
                        const b = val & 0xFF;
                        currentColor = `rgb(${r},${g},${b})`;
                    }
                }
                if (f.fieldNum === 5 && f.value === 3) {
                    // Pen type 3 = highlighter
                    isHighlighter = true;
                    currentWidth = 14;
                }
            } else if (f.type === 'fixed32') {
                const dv = new DataView(f.value.buffer, f.value.byteOffset, 4);
                const val = dv.getFloat32(0, true);
                if (isFinite(val) && val > 0.1 && val < 50) {
                    currentWidth = val;
                }
            } else if (f.type === 'bytes') {
                let byteData = f.value;
                // Decompress Apple LZ4 if compressed
                byteData = decompressAppleBv4(byteData);

                // Check for Troy Hanson TPL serialized image
                const tpl = parseTplImage(byteData, targetWidth, targetHeight);
                if (tpl && tpl.strokes && tpl.strokes.length > 0) {
                    strokes = strokes.concat(tpl.strokes);
                    continue;
                }

                // Check for nested protobuf message
                try {
                    const subFields = decodeProtoFields(byteData, 0, byteData.length);
                    if (subFields.length > 0) {
                        const subStrokes = extractStrokesFromProto(subFields, targetWidth, targetHeight, depth + 1);
                        if (subStrokes.length > 0) {
                            strokes = strokes.concat(subStrokes);
                            continue;
                        }
                    }
                } catch {
                    // Not a protobuf message, fall through to float scanning
                }

                // Heuristic float scanning
                const floatStrokes = extractStrokesFromFloatBuffer(byteData, targetWidth, targetHeight, {
                    color: currentColor,
                    width: currentWidth,
                    isHighlighter: isHighlighter,
                    opacity: isHighlighter ? 0.38 : 1.0
                });
                if (floatStrokes.length > 0) {
                    strokes = strokes.concat(floatStrokes);
                }
            }
        }
        return strokes;
    }

    /**
     * Core Function: Extract vector handwritten strokes from page notes data.
     * @param {Uint8Array} notesUint8Array - Raw bytes of notes/<UUID> file
     * @param {object} options - Optional parameters: { width, height }
     * @returns {object} { strokes: Array, strokeCount: number, hasHandwriting: boolean, warnings: Array }
     */
    function extractStrokesFromNotes(notesUint8Array, options = {}) {
        if (!notesUint8Array || notesUint8Array.length === 0) {
            return { strokes: [], strokeCount: 0, hasHandwriting: false, warnings: [] };
        }

        const width = options.width || 800;
        const height = options.height || 1000;
        const warnings = [];
        let decompressed = notesUint8Array;

        try {
            decompressed = decompressAppleBv4(notesUint8Array);
        } catch (e) {
            warnings.push('Apple LZ4 stream decompression notice: ' + (e.message || String(e)));
        }

        let strokes = [];

        // Check TPL image first
        const tpl = parseTplImage(decompressed, width, height);
        if (tpl && tpl.strokes && tpl.strokes.length > 0) {
            strokes = tpl.strokes;
        } else {
            // Decode as Protobuf length-delimited stream
            try {
                let pos = 0;
                while (pos < decompressed.length) {
                    let len;
                    [len, pos] = readVarint(decompressed, pos);
                    if (pos + len > decompressed.length) break;
                    const msgData = decompressed.subarray(pos, pos + len);
                    pos += len;
                    const fields = decodeProtoFields(msgData, 0, msgData.length);
                    const msgStrokes = extractStrokesFromProto(fields, width, height, 0);
                    if (msgStrokes.length > 0) {
                        strokes = strokes.concat(msgStrokes);
                    }
                }
            } catch (e) {
                warnings.push('Protobuf stream parse notice: ' + (e.message || String(e)));
            }

            // Fallback: raw float scan across decompressed payload if no strokes found yet
            if (strokes.length === 0 && decompressed.length >= 32) {
                const rawStrokes = extractStrokesFromFloatBuffer(decompressed, width, height, {
                    color: '#1a1a1a',
                    width: 2.2
                });
                if (rawStrokes.length > 0) {
                    strokes = rawStrokes;
                }
            }
        }

        return {
            strokes: strokes,
            strokeCount: strokes.length,
            hasHandwriting: strokes.length > 0,
            warnings: warnings
        };
    }

    /**
     * Render vector strokes smoothly to an HTML5 Canvas using quadratic Bézier interpolation.
     * @param {Array<object>} strokes - Extracted strokes
     * @param {number} width - Canvas width in pt/px
     * @param {number} height - Canvas height in pt/px
     * @param {HTMLImageElement|HTMLCanvasElement|null} background - Optional background image
     * @param {object} options - Rendering options
     * @returns {HTMLCanvasElement} Canvas with rendered handwriting
     */
    function renderStrokesToCanvas(strokes, width, height, background = null, options = {}) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext('2d');

        // Always draw pure white backing first to flatten any transparent areas
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw background if present
        if (background) {
            ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
        } else if (options.backgroundColor && options.backgroundColor !== '#FFFFFF') {
            ctx.fillStyle = options.backgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        if (!strokes || strokes.length === 0) {
            return canvas;
        }

        // Draw each stroke
        for (const stroke of strokes) {
            const pts = stroke.points;
            if (!pts || pts.length === 0) continue;

            ctx.save();
            ctx.strokeStyle = stroke.color || '#1a1a1a';
            ctx.lineWidth = stroke.width || 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (stroke.isHighlighter) {
                ctx.globalAlpha = stroke.opacity || 0.38;
                ctx.globalCompositeOperation = 'multiply';
            } else {
                ctx.globalAlpha = stroke.opacity || 1.0;
                ctx.globalCompositeOperation = 'source-over';
            }

            if (pts.length === 1) {
                // Single tap dot
                ctx.beginPath();
                ctx.arc(pts[0].x, pts[0].y, Math.max(0.75, (stroke.width || 2) / 2), 0, Math.PI * 2);
                ctx.fillStyle = stroke.color || '#1a1a1a';
                ctx.fill();
            } else if (pts.length === 2) {
                // Simple 2-point line
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                ctx.lineTo(pts[1].x, pts[1].y);
                ctx.stroke();
            } else {
                // 3+ points: smooth quadratic Bézier curve interpolation
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length - 1; i++) {
                    const midX = (pts[i].x + pts[i + 1].x) / 2;
                    const midY = (pts[i].y + pts[i + 1].y) / 2;
                    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
                }
                ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
                ctx.stroke();
            }

            ctx.restore();
        }

        return canvas;
    }

    /**
     * Render a complete notebook page combining background and handwritten content.
     * @param {object} pageData - Page metadata or identifier
     * @param {HTMLImageElement|HTMLCanvasElement|null} backgroundImg - Background image element
     * @param {Array<object>} strokes - Decoded strokes
     * @param {object} options - Page sizing and render options
     * @returns {object} { canvas, dataUrl, width, height }
     */
    function renderPageWithHandwriting(pageData, backgroundImg, strokes, options = {}) {
        let width = options.width;
        let height = options.height;

        if (backgroundImg) {
            width = width || backgroundImg.naturalWidth || backgroundImg.width || 800;
            height = height || backgroundImg.naturalHeight || backgroundImg.height || 1000;
        } else {
            width = width || 800;
            height = height || 1000;
        }

        const canvas = renderStrokesToCanvas(strokes, width, height, backgroundImg, options);
        const dataUrl = canvas.toDataURL(options.format || 'image/jpeg', options.quality || 0.95);

        return {
            canvas: canvas,
            dataUrl: dataUrl,
            width: width,
            height: height
        };
    }

    /**
     * Render vector strokes directly to an SVG document string.
     * @param {Array<object>} strokes - Decoded vector strokes
     * @param {number} width - Page width
     * @param {number} height - Page height
     * @param {string|null} backgroundDataUrl - Optional embedded background image
     * @returns {string} SVG XML markup
     */
    function renderStrokesToSvg(strokes, width, height, backgroundDataUrl = null) {
        const w = Math.round(width || 800);
        const h = Math.round(height || 1000);
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
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
     * High-level coordinator function: converts handwritten content from note data
     * and combines it with background image.
     * @param {Uint8Array} notesData - Content of notes/<UUID>
     * @param {HTMLImageElement|null} backgroundImg - Page background
     * @param {object} options
     * @returns {object}
     */
    function convertHandwrittenContent(notesData, backgroundImg, options = {}) {
        const width = backgroundImg ? (backgroundImg.naturalWidth || backgroundImg.width) : (options.width || 800);
        const height = backgroundImg ? (backgroundImg.naturalHeight || backgroundImg.height) : (options.height || 1000);

        const extraction = extractStrokesFromNotes(notesData, { width, height });
        const rendered = renderPageWithHandwriting(null, backgroundImg, extraction.strokes, { width, height, ...options });

        return {
            canvas: rendered.canvas,
            dataUrl: rendered.dataUrl,
            strokes: extraction.strokes,
            strokeCount: extraction.strokeCount,
            hasHandwriting: extraction.hasHandwriting,
            warnings: extraction.warnings,
            width: rendered.width,
            height: rendered.height
        };
    }

    return {
        readVarint,
        decodeProtoFields,
        decodeProtoStream,
        tryDecodeString,
        extractAttachmentOrderFromEvents,
        decompressLz4Block,
        decompressAppleBv4,
        parseTplImage,
        extractStrokesFromFloatBuffer,
        extractStrokesFromProto,
        extractStrokesFromNotes,
        renderStrokesToCanvas,
        renderStrokesToSvg,
        renderPageWithHandwriting,
        convertHandwrittenContent
    };
}));

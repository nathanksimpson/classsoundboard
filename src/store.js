/**
 * Soundboard storage rules.
 *
 * One team-wide board is stored as JSON in `soundboard_board`.
 * Uploaded audio and images are stored once, on the server, in
 * `soundboard_media` (content-addressed by SHA-256, split into chunks
 * because a D1 row is capped at 2 MB). Boards point at them with
 * `media:<sha256>` refs, so every computer plays the same files.
 * Browsers may keep a cache of those bytes, but never their own copy
 * of the board's references.
 */
const BOARD_ID = 'team';
const MAX_JSON_CHARS = 900000;
const MAX_SOUNDS = 5000;

/** Largest single uploaded file (bytes). */
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
/** Bytes per stored chunk — comfortably under D1's 2 MB row limit. */
const MEDIA_CHUNK_BYTES = 1024 * 1024;
const MEDIA_REF_PREFIX = 'media:';
const ALLOWED_MEDIA_TYPES = /^(audio|image)\/[a-z0-9.+-]+$/i;

function validateBoard(board) {
    if (!board || typeof board !== 'object' || Array.isArray(board)) {
        return { ok: false, error: 'Board must be an object' };
    }
    if (board.schemaVersion !== 1 && board.schemaVersion !== 2) {
        return { ok: false, error: 'Unsupported board version' };
    }
    if (!Array.isArray(board.sounds)) {
        return { ok: false, error: 'Board is missing sounds' };
    }
    if (board.sounds.length > MAX_SOUNDS) {
        return { ok: false, error: 'Too many sounds' };
    }
    for (let i = 0; i < board.sounds.length; i += 1) {
        const sound = board.sounds[i];
        if (!sound || typeof sound !== 'object') {
            return { ok: false, error: 'Invalid sound' };
        }
        if (typeof sound.id !== 'string' || !sound.id.trim()) {
            return { ok: false, error: 'Invalid sound' };
        }
        if (typeof sound.title !== 'string') {
            return { ok: false, error: 'Invalid sound title' };
        }
        const ref = sound.audioRef != null ? sound.audioRef : sound.fileUrl;
        if (typeof ref !== 'string') {
            return { ok: false, error: 'Invalid sound audio' };
        }
    }
    return { ok: true };
}

function prepareBoard(board) {
    const check = validateBoard(board);
    if (!check.ok) {
        return check;
    }
    let json;
    try {
        json = JSON.stringify(board);
    } catch (_) {
        return { ok: false, error: 'Board could not be saved' };
    }
    if (json.length > MAX_JSON_CHARS) {
        return { ok: false, error: 'Board is too large to save' };
    }
    return { ok: true, json };
}

/**
 * Decide whether a save may go ahead.
 * `baseUpdatedAt` is the server version the client's edit started from.
 * Once a board exists, a save without a base is refused: that is a page
 * still running the old code, which re-saved the whole board on every play
 * and would overwrite other computers' edits. Reloading the page fixes it.
 */
function checkSaveBase(currentUpdatedAt, baseUpdatedAt) {
    if (!currentUpdatedAt) {
        return { ok: true };
    }
    if (baseUpdatedAt == null || baseUpdatedAt === '') {
        return { ok: false, conflict: true, staleClient: true };
    }
    if (String(currentUpdatedAt) === String(baseUpdatedAt)) {
        return { ok: true };
    }
    return { ok: false, conflict: true };
}

function isValidMediaHash(hash) {
    return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
}

function normalizeMediaType(type) {
    const t = String(type || '').split(';')[0].trim().toLowerCase();
    // SVG can carry script; it is never accepted as a tile image.
    if (t.indexOf('svg') !== -1) {
        return '';
    }
    return ALLOWED_MEDIA_TYPES.test(t) ? t : '';
}

function bytesToHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
}

/** Split bytes into chunk views of at most MEDIA_CHUNK_BYTES. */
function chunkBytes(bytes) {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES) {
        chunks.push(bytes.subarray(offset, Math.min(bytes.length, offset + MEDIA_CHUNK_BYTES)));
    }
    if (!chunks.length) {
        chunks.push(bytes.subarray(0, 0));
    }
    return chunks;
}

/** Normalise a BLOB column value from D1 (array / ArrayBuffer) or SQLite (Buffer). */
function blobToBytes(value) {
    if (value == null) {
        return new Uint8Array(0);
    }
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) {
        return Uint8Array.from(value);
    }
    return new Uint8Array(0);
}

function joinChunks(chunks) {
    let total = 0;
    chunks.forEach((c) => { total += c.length; });
    const out = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((c) => {
        out.set(c, offset);
        offset += c.length;
    });
    return out;
}

const CREATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS soundboard_board (
        id TEXT PRIMARY KEY,
        board_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by_user_id TEXT
    );
`;

const CREATE_MEDIA_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS soundboard_media (
        hash TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        mime TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL,
        created_by_user_id TEXT,
        PRIMARY KEY (hash, chunk_index)
    );
`;

export {
    BOARD_ID,
    MAX_JSON_CHARS,
    MAX_MEDIA_BYTES,
    MEDIA_CHUNK_BYTES,
    MEDIA_REF_PREFIX,
    CREATE_TABLE_SQL,
    CREATE_MEDIA_TABLE_SQL,
    validateBoard,
    prepareBoard,
    checkSaveBase,
    isValidMediaHash,
    normalizeMediaType,
    bytesToHex,
    chunkBytes,
    blobToBytes,
    joinChunks
};

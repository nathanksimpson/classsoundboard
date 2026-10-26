import { dbAll, dbOne, dbRun, rowsChanged } from './db.js';
import {
    BOARD_ID,
    CREATE_TABLE_SQL,
    CREATE_MEDIA_TABLE_SQL,
    MAX_MEDIA_BYTES,
    MEDIA_REF_PREFIX,
    prepareBoard,
    checkSaveBase,
    isValidMediaHash,
    normalizeMediaType,
    bytesToHex,
    chunkBytes,
    blobToBytes,
    joinChunks
} from './store.js';

let tablesReady = null;

function ensureTables(env) {
    if (!tablesReady) {
        tablesReady = Promise.all([
            dbRun(env, CREATE_TABLE_SQL),
            dbRun(env, CREATE_MEDIA_TABLE_SQL)
        ]).catch((err) => {
            tablesReady = null;
            throw err;
        });
    }
    return tablesReady;
}

function httpError(message, status, extra) {
    const err = new Error(message);
    err.status = status;
    if (extra) {
        Object.assign(err, extra);
    }
    return err;
}

async function readRow(env) {
    return dbOne(
        env,
        'SELECT board_json, updated_at FROM soundboard_board WHERE id = ?',
        BOARD_ID
    );
}

function parseRow(row) {
    if (!row || !row.board_json) {
        return { board: null, updatedAt: null };
    }
    try {
        return { board: JSON.parse(row.board_json), updatedAt: row.updated_at || null };
    } catch (_) {
        return { board: null, updatedAt: row.updated_at || null };
    }
}

/**
 * Load the shared board. With `since`, returns `{ unchanged: true }`
 * (no board body) when nothing changed — used for cheap polling.
 */
/**
 * One-time move from ClassManager: if this site has no board yet and the
 * LEGACY_DB binding (ClassManager's calendar-team database) is attached,
 * copy its soundboard row across. Only ever reads that one table.
 * Remove the LEGACY_DB binding from wrangler.jsonc once the board is here.
 */
let legacyChecked = false;
async function importLegacyBoardIfEmpty(env) {
    if (legacyChecked || !env.LEGACY_DB) return;
    const existing = await dbOne(env, 'SELECT id FROM soundboard_board WHERE id = ?', BOARD_ID);
    if (existing) {
        legacyChecked = true;
        return;
    }
    let row = null;
    try {
        row = await env.LEGACY_DB
            .prepare('SELECT board_json, updated_at FROM soundboard_board WHERE id = ?')
            .bind(BOARD_ID)
            .first();
    } catch (err) {
        console.warn('soundboard: legacy import read failed', err);
        legacyChecked = true;
        return;
    }
    legacyChecked = true;
    if (!row || !row.board_json) return;
    let board;
    try {
        board = JSON.parse(row.board_json);
    } catch (_) {
        return;
    }
    const prepared = prepareBoard(board);
    if (!prepared.ok) return;
    await dbRun(
        env,
        `INSERT OR IGNORE INTO soundboard_board (id, board_json, updated_at, updated_by_user_id)
         VALUES (?, ?, ?, ?)`,
        BOARD_ID,
        prepared.json,
        new Date().toISOString(),
        'migrated-from-classmanager'
    );
}

export async function getBoard(env, since) {
    await ensureTables(env);
    await importLegacyBoardIfEmpty(env);
    if (since) {
        const head = await dbOne(
            env,
            'SELECT updated_at FROM soundboard_board WHERE id = ?',
            BOARD_ID
        );
        if (head && head.updated_at === since) {
            return { unchanged: true, updatedAt: head.updated_at };
        }
    }
    return parseRow(await readRow(env));
}

/**
 * Save the shared board. When `baseUpdatedAt` doesn't match the stored
 * version, throws 409 with the current board so the client can merge.
 */
export async function saveBoard(env, board, userId, baseUpdatedAt) {
    await ensureTables(env);
    await importLegacyBoardIfEmpty(env);
    const prepared = prepareBoard(board);
    if (!prepared.ok) {
        throw httpError(prepared.error, 400);
    }
    const current = await readRow(env);
    const currentUpdatedAt = current ? current.updated_at : null;
    const check = checkSaveBase(currentUpdatedAt, baseUpdatedAt);
    if (!check.ok) {
        const parsed = parseRow(current);
        throw httpError('The sound board was changed on another computer.', 409, {
            body: { error: 'conflict', board: parsed.board, updatedAt: parsed.updatedAt }
        });
    }

    let updatedAt = new Date().toISOString();
    if (currentUpdatedAt && updatedAt <= currentUpdatedAt) {
        // Keep versions strictly increasing even if two saves land in the same millisecond.
        updatedAt = new Date(Date.parse(currentUpdatedAt) + 1).toISOString();
    }

    if (current) {
        const result = await dbRun(
            env,
            `UPDATE soundboard_board
             SET board_json = ?, updated_at = ?, updated_by_user_id = ?
             WHERE id = ? AND updated_at = ?`,
            prepared.json,
            updatedAt,
            userId || null,
            BOARD_ID,
            currentUpdatedAt
        );
        if (rowsChanged(result) === 0) {
            const latest = parseRow(await readRow(env));
            throw httpError('The sound board was changed on another computer.', 409, {
                body: { error: 'conflict', board: latest.board, updatedAt: latest.updatedAt }
            });
        }
    } else {
        await dbRun(
            env,
            `INSERT INTO soundboard_board (id, board_json, updated_at, updated_by_user_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               board_json = excluded.board_json,
               updated_at = excluded.updated_at,
               updated_by_user_id = excluded.updated_by_user_id`,
            BOARD_ID,
            prepared.json,
            updatedAt,
            userId || null
        );
    }
    return { ok: true, updatedAt };
}

/** Store one uploaded audio/image file. Returns its shared `media:<sha256>` ref. */
export async function putMedia(env, request, userId) {
    await ensureTables(env);
    const mime = normalizeMediaType(request.headers.get('Content-Type'));
    if (!mime) {
        throw httpError('Only audio or image files can be uploaded', 415);
    }
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > MAX_MEDIA_BYTES) {
        throw httpError('File is too large (15 MB max)', 413);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) {
        throw httpError('Empty file', 400);
    }
    if (bytes.length > MAX_MEDIA_BYTES) {
        throw httpError('File is too large (15 MB max)', 413);
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = bytesToHex(new Uint8Array(digest));

    const existing = await dbOne(
        env,
        'SELECT chunk_count FROM soundboard_media WHERE hash = ? AND chunk_index = 0',
        hash
    );
    if (existing) {
        const have = await dbOne(
            env,
            'SELECT COUNT(*) AS n FROM soundboard_media WHERE hash = ?',
            hash
        );
        if (have && Number(have.n) === Number(existing.chunk_count)) {
            return { ok: true, ref: MEDIA_REF_PREFIX + hash, hash, size: bytes.length, mime, reused: true };
        }
    }

    const chunks = chunkBytes(bytes);
    const createdAt = new Date().toISOString();
    const stmts = chunks.map((chunk, index) => env.DB
        .prepare(
            `INSERT OR REPLACE INTO soundboard_media
             (hash, chunk_index, chunk_count, mime, byte_size, data, created_at, created_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        // Bind an exact-size ArrayBuffer (D1's BLOB type), not a view into the whole file.
        .bind(hash, index, chunks.length, mime, bytes.length, chunk.slice().buffer, createdAt, userId || null));
    // One chunk per request keeps every D1 call small (~1 MB). A half-finished
    // upload is never served (GET needs every chunk) and is completed on retry.
    for (const stmt of stmts) {
        await stmt.run();
    }
    return { ok: true, ref: MEDIA_REF_PREFIX + hash, hash, size: bytes.length, mime };
}

/** Serve a stored file. Content never changes for a given hash, so it caches forever. */
export async function getMediaResponse(env, hash) {
    if (!isValidMediaHash(hash)) {
        return new Response('Not found', { status: 404 });
    }
    await ensureTables(env);
    const rows = await dbAll(
        env,
        `SELECT chunk_index, chunk_count, mime, byte_size, data
         FROM soundboard_media WHERE hash = ? ORDER BY chunk_index`,
        hash
    );
    if (!rows.length || rows.length !== Number(rows[0].chunk_count)) {
        return new Response('Not found', { status: 404 });
    }
    const bytes = joinChunks(rows.map((r) => blobToBytes(r.data)));
    return new Response(bytes, {
        status: 200,
        headers: {
            'Content-Type': rows[0].mime || 'application/octet-stream',
            'Content-Length': String(bytes.length),
            'Cache-Control': 'private, max-age=31536000, immutable',
            ETag: '"' + hash + '"',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox"
        }
    });
}

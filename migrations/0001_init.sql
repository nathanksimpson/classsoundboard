-- One team-wide board, stored as JSON.
CREATE TABLE IF NOT EXISTS soundboard_board (
    id TEXT PRIMARY KEY,
    board_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by_user_id TEXT
);

-- Uploaded audio/images, stored once and shared by every computer.
-- Content-addressed by SHA-256, split into 1 MB chunks (D1 rows max 2 MB).
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

-- Failed sign-in attempts per IP (rate limiting).
CREATE TABLE IF NOT EXISTS login_failures (
    ip TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    failures INTEGER NOT NULL
);

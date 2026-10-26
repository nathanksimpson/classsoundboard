/** D1 query helpers. */
export async function dbOne(env, sql, ...params) {
    const stmt = env.DB.prepare(sql);
    return params.length ? stmt.bind(...params).first() : stmt.first();
}

export async function dbAll(env, sql, ...params) {
    const stmt = env.DB.prepare(sql);
    const r = params.length ? await stmt.bind(...params).all() : await stmt.all();
    return r.results || [];
}

export async function dbRun(env, sql, ...params) {
    const stmt = env.DB.prepare(sql);
    return params.length ? stmt.bind(...params).run() : stmt.run();
}

/** Rows written by a dbRun result (0 = a compare-and-set guard did not match). */
export function rowsChanged(result) {
    if (result && result.meta && typeof result.meta.changes === 'number') {
        return result.meta.changes;
    }
    return 0;
}

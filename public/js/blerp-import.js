/**
 * blerp-import.js — Import a single sound from a Blerp soundbites URL.
 */
(function () {
  const BLERP_PAGE = 'https://blerp.com/soundbites/';

  function getMedia() {
    return window.SoundboardMediaResolver;
  }

  function getSchema() {
    return window.SoundboardSchema;
  }

  function parseBlerpSoundId(urlOrId) {
    const Media = getMedia();
    if (Media && Media.parseBlerpSoundId) return Media.parseBlerpSoundId(urlOrId);
    const text = String(urlOrId || '').trim();
    const pathMatch = text.match(/\/soundbites\/([a-zA-Z0-9]+)/i);
    if (pathMatch) return pathMatch[1];
    if (/^[a-f0-9]{24}$/i.test(text)) return text;
    return null;
  }

  function findExistingByBlerpId(board, biteId) {
    if (!board || !biteId) return null;
    const id = String(biteId).trim();
    return (board.sounds || []).find(function (s) {
      if (String(s.id) === id) return true;
      const extra = s.extra || {};
      return String(extra.blerpId || '').trim() === id;
    }) || null;
  }

  function buildSoundFromBlerp(biteId, pageUrl, meta) {
    const Schema = getSchema();
    const audioUrl = meta && meta.audioUrl ? String(meta.audioUrl).trim() : '';
    const imageUrl = meta && meta.imageUrl ? String(meta.imageUrl).trim() : '';
    const title = meta && meta.title ? String(meta.title).trim() : '';
    const extra = {
      source: 'blerp',
      blerpId: biteId,
      blerpUrl: pageUrl || (BLERP_PAGE + biteId)
    };
    if (audioUrl) extra.blerpAudioUrl = audioUrl;
    return Schema.createDefaultSound({
      id: biteId,
      title: title || 'Blerp sound',
      audioRef: audioUrl ? 'remote:' + audioUrl : '',
      imageRef: imageUrl ? 'remote:' + imageUrl : '',
      category: 'Blerp',
      extra: extra
    });
  }

  async function importFromUrl(url, board) {
    const normalized = String(url || '').trim();
    if (!normalized) {
      return { ok: false, error: 'Please paste a Blerp sound link.' };
    }
    const biteId = parseBlerpSoundId(normalized);
    if (!biteId) {
      return {
        ok: false,
        error: 'That does not look like a Blerp sound URL. Example: https://blerp.com/soundbites/<id>'
      };
    }

    const existing = findExistingByBlerpId(board, biteId);
    if (existing) {
      return { ok: false, duplicate: true, sound: existing, biteId: biteId };
    }

    const pageUrl = normalized.includes('blerp.com') ? normalized.split(/[?#]/)[0] : (BLERP_PAGE + biteId);
    const Media = getMedia();
    let meta = { audioUrl: null, title: '', imageUrl: '' };
    if (Media && Media.fetchBlerpMetadata) {
      meta = await Media.fetchBlerpMetadata(biteId);
    }

    const sound = buildSoundFromBlerp(biteId, pageUrl, meta);
    if (!meta.audioUrl) {
      return {
        ok: true,
        partial: true,
        sound: sound,
        biteId: biteId,
        warning: 'Could not auto-find audio for this Blerp sound. The editor is open so you can paste the audio URL manually.'
      };
    }

    return { ok: true, sound: sound, biteId: biteId };
  }

  function looksLikeBlerpUrl(text) {
    const t = String(text || '').trim();
    return t.includes('blerp.com/soundbites/') || /^[a-f0-9]{24}$/i.test(t);
  }

  window.SoundboardBlerpImport = {
    parseBlerpSoundId,
    findExistingByBlerpId,
    buildSoundFromBlerp,
    importFromUrl,
    looksLikeBlerpUrl
  };
})();

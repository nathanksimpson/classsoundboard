/**
 * media-resolver.js — Resolve audio bytes for playback and import.
 */
(function () {
  const BLERP_CDN = 'cdn.blerp.com';
  const BLERP_GRAPHQL = 'https://api.blerp.com/graphql';
  const BLERP_GRAPHQL_QUERY = `query webBitePageGetBite($_id: MongoID!) {
  web {
    biteById(_id: $_id) {
      _id
      audio {
        mp3 { url }
      }
    }
  }
}`;

  function resolveUrl(url) {
    const u = String(url || '').trim();
    if (!u) return u;
    const mediaHash = u.match(/^media:([a-f0-9]{64})$/);
    if (mediaHash) return '/api/soundboard/media/' + mediaHash[1];
    if (u.startsWith('/media/') || u.startsWith('/boards/')) return u;
    if (u.startsWith('/')) return u;
    return u;
  }

  function isPngBuffer(ab) {
    if (!ab || ab.byteLength < 4) return false;
    const u8 = new Uint8Array(ab);
    return u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
  }

  function isBadBlerpAudioUrl(url) {
    const u = String(url || '').toLowerCase();
    if (!u) return true;
    if (u.includes('favicon') || u.includes('/thumbnails/')) return true;
    if (u.endsWith('.png') || u.endsWith('.jpg') || u.endsWith('.jpeg') || u.endsWith('.webp')) return true;
    return false;
  }

  function parseBlerpSoundId(urlOrId) {
    const text = String(urlOrId || '').trim();
    const pathMatch = text.match(/\/soundbites\/([a-zA-Z0-9]+)/i);
    if (pathMatch) return pathMatch[1];
    if (/^[a-f0-9]{24}$/i.test(text)) return text;
    return null;
  }

  function parseBlerpId(sound) {
    if (!sound) return null;
    const ref = String(sound.fileUrl || sound.audioRef || '').trim();
    if (ref.startsWith('blerp:')) {
      const id = ref.slice(6).trim();
      if (/^[a-f0-9]{24}$/i.test(id)) return id;
    }
    const extra = sound.extra || {};
    if (extra.blerpId) {
      const fromExtra = parseBlerpSoundId(extra.blerpId);
      if (fromExtra) return fromExtra;
    }
    if (extra.blerpUrl) {
      const fromUrl = parseBlerpSoundId(extra.blerpUrl);
      if (fromUrl) return fromUrl;
    }
    if (/^[a-f0-9]{24}$/i.test(String(sound.id))) return String(sound.id);
    return null;
  }

  function parseOgMetaFromHtml(text) {
    const meta = { title: '', imageUrl: '' };
    if (!text) return meta;
    const titleMatch = text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (titleMatch && titleMatch[1]) meta.title = titleMatch[1].trim();
    const imgMatch = text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (imgMatch && imgMatch[1]) meta.imageUrl = imgMatch[1].trim();
    return meta;
  }

  async function fetchBlerpPageMeta(biteId) {
    const pageUrl = 'https://blerp.com/soundbites/' + biteId;
    const targets = [pageUrl, 'https://r.jina.ai/http://' + pageUrl.replace(/^https?:\/\//i, '')];
    const meta = { title: '', imageUrl: '', audioUrl: '' };
    for (let i = 0; i < targets.length; i++) {
      try {
        const res = await fetch(targets[i]);
        if (!res.ok) continue;
        const text = await res.text();
        const og = parseOgMetaFromHtml(text);
        if (og.title && !meta.title) meta.title = og.title;
        if (og.imageUrl && !meta.imageUrl) meta.imageUrl = og.imageUrl;
        if (!meta.audioUrl) {
          const direct = text.match(/https?:\/\/[^"'\\\s<>]+?\.(mp3|wav|ogg|m4a)(\?[^"'\\\s<>]*)?/i);
          if (direct && !isBadBlerpAudioUrl(direct[0])) meta.audioUrl = direct[0];
        }
        if (!meta.audioUrl) {
          const cdnAll = text.match(new RegExp('https?:\\/\\/[^"\'\\\\\\s<>]*' + BLERP_CDN.replace('.', '\\.') + '[^"\'\\\\\\s<>]+', 'gi')) || [];
          for (let j = 0; j < cdnAll.length; j++) {
            const candidate = cdnAll[j].replace(/[),.;]+$/, '');
            if (!isBadBlerpAudioUrl(candidate) && !candidate.includes('/thumbnails/')) {
              meta.audioUrl = candidate;
              break;
            }
          }
        }
        if (meta.title && meta.audioUrl) break;
      } catch (e) {
        console.warn('media-resolver: blerp page meta failed', biteId, e);
      }
    }
    return meta;
  }

  async function fetchBlerpMetadata(biteId) {
    if (!biteId) return { audioUrl: null, title: '', imageUrl: '' };
    let audioUrl = await fetchBlerpMp3UrlViaGraphQL(biteId);
    const pageMeta = await fetchBlerpPageMeta(biteId);
    if (!audioUrl && pageMeta.audioUrl) audioUrl = pageMeta.audioUrl;
    if (!audioUrl) audioUrl = await scrapeBlerpAudioUrl(biteId);
    return {
      audioUrl: audioUrl || null,
      title: pageMeta.title || '',
      imageUrl: pageMeta.imageUrl || ''
    };
  }

  async function fetchBlerpMp3UrlViaGraphQL(biteId) {
    if (!biteId) return null;
    try {
      const res = await fetch(BLERP_GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationName: 'webBitePageGetBite',
          query: BLERP_GRAPHQL_QUERY,
          variables: { _id: biteId }
        })
      });
      if (!res.ok) return null;
      const json = await res.json();
      const bite = json.data && json.data.web && json.data.web.biteById;
      const url = bite && bite.audio && bite.audio.mp3 && bite.audio.mp3.url;
      const trimmed = url ? String(url).trim() : '';
      return trimmed && !isBadBlerpAudioUrl(trimmed) ? trimmed : null;
    } catch (e) {
      console.warn('media-resolver: graphql failed', biteId, e);
      return null;
    }
  }

  async function resolveBlerpAudioUrl(sound) {
    const extra = sound && sound.extra ? sound.extra : {};
    if (extra.blerpAudioUrl && !isBadBlerpAudioUrl(extra.blerpAudioUrl)) {
      return String(extra.blerpAudioUrl).trim();
    }
    const biteId = parseBlerpId(sound);
    if (!biteId) return null;
    const fromApi = await fetchBlerpMp3UrlViaGraphQL(biteId);
    if (fromApi) {
      if (sound && typeof sound === 'object') {
        if (!sound.extra || typeof sound.extra !== 'object') sound.extra = {};
        sound.extra.blerpAudioUrl = fromApi;
        if (!sound.extra.blerpId) sound.extra.blerpId = biteId;
      }
      return fromApi;
    }
    return scrapeBlerpAudioUrl(biteId);
  }

  async function scrapeBlerpAudioUrl(soundId) {
    const pageUrl = 'https://blerp.com/soundbites/' + soundId;
    const targets = [pageUrl, 'https://r.jina.ai/http://' + pageUrl.replace(/^https?:\/\//i, '')];
    for (let i = 0; i < targets.length; i++) {
      try {
        const res = await fetch(targets[i]);
        if (!res.ok) continue;
        const text = await res.text();
        const direct = text.match(/https?:\/\/[^"'\\\s<>]+?\.(mp3|wav|ogg|m4a)(\?[^"'\\\s<>]*)?/i);
        if (direct && !isBadBlerpAudioUrl(direct[0])) return direct[0];
        const cdnAll = text.match(new RegExp('https?:\\/\\/[^"\'\\\\\\s<>]*' + BLERP_CDN.replace('.', '\\.') + '[^"\'\\\\\\s<>]+', 'gi')) || [];
        for (let j = 0; j < cdnAll.length; j++) {
          const candidate = cdnAll[j].replace(/[),.;]+$/, '');
          if (!isBadBlerpAudioUrl(candidate) && !candidate.includes('/thumbnails/')) return candidate;
        }
      } catch (e) {
        console.warn('media-resolver: blerp scrape failed', soundId, e);
      }
    }
    return null;
  }

  async function fetchUrlArrayBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed ' + res.status);
    const ab = await res.arrayBuffer();
    if (isPngBuffer(ab)) throw new Error('response is PNG, not audio');
    return ab;
  }

  async function fetchAudioArrayBuffer(sound) {
    if (!sound) return null;
    const ref = String(sound.fileUrl || sound.audioRef || '').trim();
    const Repo = window.SoundboardRepository;

    const mediaHash = Repo && Repo.parseMediaRef ? Repo.parseMediaRef(ref) : null;
    if (mediaHash) {
      return { arrayBuffer: await Repo.getMediaBytes(mediaHash), source: 'shared' };
    }

    const blobRef = Repo && Repo.parseBlobRef(ref);
    if (blobRef) {
      const bytes = await Repo.getBlob(blobRef.key);
      if (bytes) return { arrayBuffer: bytes, source: 'idb' };
    }

    if (ref.startsWith('remote:')) {
      const url = ref.slice('remote:'.length);
      if (!isBadBlerpAudioUrl(url)) {
        return { arrayBuffer: await fetchUrlArrayBuffer(url), source: 'remote' };
      }
    }

    if (ref.startsWith('blerp:')) {
      const blerpUrl = await resolveBlerpAudioUrl(sound);
      if (blerpUrl) {
        return { arrayBuffer: await fetchUrlArrayBuffer(blerpUrl), source: 'blerp-graphql' };
      }
    }

    const url = resolveUrl(ref);
    if (url && (/^https?:/i.test(url) || url.startsWith('/'))) {
      try {
        const ab = await fetchUrlArrayBuffer(url);
        return { arrayBuffer: ab, source: url.startsWith('/') ? 'hosted' : 'url' };
      } catch (e) {
        console.warn('media-resolver: direct fetch failed, trying Blerp fallback', url, e);
      }
    }

    const blerpId = parseBlerpId(sound);
    if (blerpId) {
      const blerpUrl = await resolveBlerpAudioUrl(sound);
      if (blerpUrl) {
        return { arrayBuffer: await fetchUrlArrayBuffer(blerpUrl), source: 'blerp' };
      }
    }

    return null;
  }

  window.SoundboardMediaResolver = {
    fetchAudioArrayBuffer,
    fetchBlerpMp3UrlViaGraphQL,
    fetchBlerpMetadata,
    fetchBlerpPageMeta,
    resolveBlerpAudioUrl,
    scrapeBlerpAudioUrl,
    parseBlerpSoundId,
    resolveUrl,
    isBadBlerpAudioUrl,
    isPngBuffer
  };
})();

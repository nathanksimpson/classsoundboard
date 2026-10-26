/**
 * export-service.js — Export JSON and portable ZIP.
 */
(function () {
  function safeName(value) {
    return String(value || 'file').trim().replace(/[^a-z0-9-_.]/gi, '-').replace(/-+/g, '-').slice(0, 80) || 'file';
  }

  function timestampForFilename(d) {
    const date = d instanceof Date ? d : new Date();
    const pad2 = function (n) { return String(n).padStart(2, '0'); };
    const yyyy = date.getFullYear();
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const mi = pad2(date.getMinutes());
    const ss = pad2(date.getSeconds());
    return yyyy + mm + dd + '-' + hh + mi + ss;
  }

  function exportBaseName(board) {
    return safeName(board && board.name ? board.name : 'board');
  }

  function buildExportFilename(board, kind, ext) {
    const base = exportBaseName(board);
    const stamp = timestampForFilename();
    if (kind === 'portable') {
      return base + '-portable-' + stamp + '.' + ext;
    }
    return base + '-' + stamp + '.' + ext;
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function shareOrDownload(blob, filename, mime) {
    const name = safeName(filename);
    const type = mime || blob.type || 'application/octet-stream';
    try {
      if (navigator.canShare && navigator.share && typeof File === 'function') {
        const file = new File([blob], name, { type });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return;
        }
      }
    } catch (_) {}
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
  }

  async function fetchAudioBytes(sound) {
    const Media = window.SoundboardMediaResolver;
    const play = window.SoundboardSchema.soundForPlayback(sound);
    if (Media && Media.fetchAudioArrayBuffer) {
      const r = await Media.fetchAudioArrayBuffer(play);
      if (r && r.arrayBuffer) return r.arrayBuffer;
    }
    const ref = String(sound.audioRef || '');
    if (/^https?:/i.test(ref) || ref.startsWith('/')) {
      const res = await fetch(ref);
      if (res.ok) return res.arrayBuffer();
    }
    return null;
  }

  async function fetchImageBytes(sound) {
    const ref = String(sound.imageRef || '');
    const Repo = window.SoundboardRepository;
    const mediaHash = Repo.parseMediaRef(ref);
    if (mediaHash) {
      return Repo.getMediaBytes(mediaHash);
    }
    const parsed = Repo.parseBlobRef(ref);
    if (parsed) {
      return Repo.getBlob(parsed.key);
    }
    if (/^https?:/i.test(ref) || ref.startsWith('/')) {
      const res = await fetch(ref);
      if (res.ok) return res.arrayBuffer();
    }
    return null;
  }

  function exportJson(board) {
    const Schema = window.SoundboardSchema;
    const json = JSON.stringify(Schema.normalizeBoard(board), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const name = buildExportFilename(board, 'json', 'json');
    return shareOrDownload(blob, name, 'application/json');
  }

  async function exportPortableZip(board, options) {
    if (!window.JSZip) throw new Error('JSZip missing');
    const Schema = window.SoundboardSchema;
    const opts = options || {};
    const zip = new JSZip();
    const portable = JSON.parse(JSON.stringify(Schema.normalizeBoard(board)));
    const warnings = [];
    const audioFolder = zip.folder('audio');
    const imagesFolder = zip.folder('images');
    const total = portable.sounds.length;
    let done = 0;

    for (const s of portable.sounds) {
      done++;
      if (opts.onProgress) opts.onProgress('Packing ' + done + '/' + total);
      const id = String(s.id);
      const ext = 'mp3';
      const audioName = safeName(id) + '.' + ext;
      try {
        const ab = await fetchAudioBytes(s);
        if (ab) {
          audioFolder.file(audioName, ab);
          s.audioRef = 'zip:audio/' + audioName;
        } else {
          warnings.push('Missing audio: ' + (s.title || id));
        }
      } catch (e) {
        warnings.push('Audio error: ' + (s.title || id));
      }

      const iu = String(s.imageRef || '');
      if (iu) {
        try {
          const ib = await fetchImageBytes(s);
          if (ib) {
            const imgExt = iu.includes('.webp') ? 'webp' : iu.includes('.png') ? 'png' : 'jpg';
            const imgName = safeName(id) + '.' + imgExt;
            imagesFolder.file(imgName, ib);
            s.imageRef = 'zip:images/' + imgName;
          }
        } catch (_) {}
      }
    }

    zip.file('board.json', JSON.stringify(portable, null, 2));
    zip.file('manifest.json', JSON.stringify({
      type: 'soundboard-portable',
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      soundCount: portable.sounds.length
    }, null, 2));

    const out = await zip.generateAsync({ type: 'blob' });
    const name = buildExportFilename(board, 'portable', 'zip');
    await shareOrDownload(out, name, 'application/zip');
    return { warnings };
  }

  window.SoundboardExportService = {
    exportJson,
    exportPortableZip,
    shareOrDownload
  };
})();

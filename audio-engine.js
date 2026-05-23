/**
 * audio-engine.js — Web Audio API: load, cache, play with trim and volume.
 * Pipeline: AudioContext → fetch/decode → AudioBuffer → BufferSource → GainNode → destination
 * Normalization: ITU-R BS.1770 LUFS (see loudness.js), target -14 LUFS.
 */

const MAX_SIMULTANEOUS_SOUNDS = 6;
const PRELOAD_COUNT = 10;
const NORM_ALGO_VERSION = 2;
const TARGET_LUFS = -14;
const MAX_NORM_GAIN_LINEAR = Math.pow(10, 12 / 20);

let ctx = null;
let masterVolume = 1;
let autoLevelEnabled = true;
let compressorEnabled = true;
let masterGainNode = null;
let compressorNode = null;
const audioCache = new Map();
const normGainCache = new Map(); // fileUrl -> { gain, algoVersion }
const activeSources = [];

function getContext() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

function ensureMasterChain() {
  const c = getContext();
  if (!c) return null;
  if (masterGainNode && compressorNode) return { masterGainNode, compressorNode };

  masterGainNode = c.createGain();
  masterGainNode.gain.setValueAtTime(masterVolume, c.currentTime);

  compressorNode = c.createDynamicsCompressor();
  applyCompressorSettings(compressorEnabled);

  masterGainNode.connect(compressorNode);
  compressorNode.connect(c.destination);

  return { masterGainNode, compressorNode };
}

function applyCompressorSettings(enabled) {
  const c = getContext();
  if (!c || !compressorNode) return;
  const comp = compressorNode;
  if (enabled) {
    comp.threshold.setValueAtTime(-18, c.currentTime);
    comp.knee.setValueAtTime(24, c.currentTime);
    comp.ratio.setValueAtTime(3, c.currentTime);
    comp.attack.setValueAtTime(0.003, c.currentTime);
    comp.release.setValueAtTime(0.25, c.currentTime);
  } else {
    comp.threshold.setValueAtTime(0, c.currentTime);
    comp.knee.setValueAtTime(0, c.currentTime);
    comp.ratio.setValueAtTime(1, c.currentTime);
    comp.attack.setValueAtTime(0.003, c.currentTime);
    comp.release.setValueAtTime(0.25, c.currentTime);
  }
}

function clampVolume(v) {
  if (typeof v !== 'number' || isNaN(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

function clampNormGain(g) {
  if (typeof g !== 'number' || !isFinite(g)) return 1;
  return Math.max(0, Math.min(MAX_NORM_GAIN_LINEAR, g));
}

function trimRangeFromSound(sound, buffer) {
  if (!buffer) return { startSec: 0, endSec: 0 };
  const startMs = sound && sound.startMs != null ? sound.startMs : 0;
  const endMs = sound && sound.endMs != null ? sound.endMs : buffer.duration * 1000;
  const startSec = Math.max(0, startMs / 1000);
  const endSec = Math.min(buffer.duration, endMs / 1000);
  if (endSec <= startSec) return { startSec: 0, endSec: buffer.duration };
  return { startSec, endSec };
}

async function loadBuffer(fileUrl) {
  const c = getContext();
  if (!c) return null;
  if (audioCache.has(fileUrl)) return audioCache.get(fileUrl);
  try {
    let ab;
    if (typeof fileUrl === 'string' && fileUrl.startsWith('local:')) {
      const LocalAudio = window.SoundboardLocalAudio;
      if (!LocalAudio || !LocalAudio.getBlob) return null;
      const blobId = fileUrl.slice(6);
      ab = await LocalAudio.getBlob(blobId);
      if (!ab) return null;
    } else {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(res.statusText);
      ab = await res.arrayBuffer();
    }
    const buf = await c.decodeAudioData(ab.slice(0));
    audioCache.set(fileUrl, buf);
    return buf;
  } catch (e) {
    console.warn('audio-engine: load failed', fileUrl, e);
    return null;
  }
}

function pruneOldestActive() {
  while (activeSources.length >= MAX_SIMULTANEOUS_SOUNDS && activeSources.length > 0) {
    const old = activeSources.shift();
    try { old.src.stop(); } catch (_) {}
  }
}

function stopSound(soundId) {
  for (let i = activeSources.length - 1; i >= 0; i--) {
    const entry = activeSources[i];
    if (!soundId || entry.soundId === soundId) {
      try { entry.src.stop(); } catch (_) {}
      activeSources.splice(i, 1);
    }
  }
}

function computeNormalizationFromBuffer(buffer, range) {
  if (!buffer) return null;
  const Loudness = window.SoundboardLoudness;
  if (Loudness && Loudness.computeNormalizationGain) {
    const res = Loudness.computeNormalizationGain(buffer, {
      startSec: range && range.startSec,
      endSec: range && range.endSec,
      targetLufs: TARGET_LUFS
    });
    if (!res || typeof res.gain !== 'number' || !isFinite(res.gain)) return null;
    return {
      gain: res.gain,
      gainDb: res.gainDb,
      lufs: res.lufs,
      truePeakDb: res.truePeakDb,
      algoVersion: res.algoVersion || NORM_ALGO_VERSION
    };
  }
  return null;
}

function cacheKeyForAnalyze(fileUrl, range) {
  const s = range && range.startSec != null ? range.startSec.toFixed(3) : '0';
  const e = range && range.endSec != null ? range.endSec.toFixed(3) : 'full';
  return fileUrl + '|' + s + '|' + e;
}

function analyzeFileUrl(fileUrl, soundOrOpts) {
  if (!fileUrl) return Promise.resolve(null);
  const sound = soundOrOpts && soundOrOpts.fileUrl ? soundOrOpts : null;
  const opts = sound || soundOrOpts || {};

  return loadBuffer(fileUrl).then((buffer) => {
    if (!buffer) return null;
    const range = trimRangeFromSound(
      sound || { startMs: opts.startMs, endMs: opts.endMs },
      buffer
    );
    const key = cacheKeyForAnalyze(fileUrl, range);
    if (normGainCache.has(key)) {
      const cached = normGainCache.get(key);
      return { ...cached, algoVersion: cached.algoVersion || NORM_ALGO_VERSION };
    }
    const res = computeNormalizationFromBuffer(buffer, range);
    if (!res || typeof res.gain !== 'number' || !isFinite(res.gain)) return null;
    const entry = {
      gain: res.gain,
      gainDb: res.gainDb,
      lufs: res.lufs,
      truePeakDb: res.truePeakDb,
      algoVersion: res.algoVersion || NORM_ALGO_VERSION
    };
    normGainCache.set(key, entry);
    normGainCache.set(fileUrl, entry);
    return entry;
  });
}

function playSound(sound) {
  if (!sound || !sound.fileUrl) return Promise.resolve(false);
  const c = getContext();
  if (!c) return Promise.resolve(false);
  const chain = ensureMasterChain();
  if (!chain) return Promise.resolve(false);

  return loadBuffer(sound.fileUrl).then((buffer) => {
    if (!buffer) return false;
    const perSound = clampVolume(sound.volume != null ? sound.volume : 1);
    let normGain = 1;
    if (autoLevelEnabled) {
      const fromExtra = sound && sound.extra && typeof sound.extra.normGain === 'number' && isFinite(sound.extra.normGain)
        ? sound.extra.normGain
        : null;
      if (fromExtra != null) {
        normGain = clampNormGain(fromExtra);
      } else {
        const range = trimRangeFromSound(sound, buffer);
        const key = cacheKeyForAnalyze(sound.fileUrl, range);
        if (normGainCache.has(key)) {
          normGain = clampNormGain(normGainCache.get(key).gain);
        } else if (normGainCache.has(sound.fileUrl)) {
          normGain = clampNormGain(normGainCache.get(sound.fileUrl).gain);
        } else {
          analyzeFileUrl(sound.fileUrl, sound).catch(function () {});
        }
      }
    }
    const vol = perSound * normGain;
    const startMs = sound.startMs != null ? sound.startMs : 0;
    const endMs = sound.endMs != null ? sound.endMs : (buffer.duration * 1000);
    const startSec = Math.max(0, startMs / 1000);
    const endSec = Math.min(buffer.duration, endMs / 1000);
    const duration = Math.max(0, endSec - startSec);

    const gainNode = c.createGain();
    gainNode.gain.setValueAtTime(vol, c.currentTime);
    gainNode.connect(masterGainNode);

    const rate = Math.max(0.25, Math.min(4, typeof sound.playbackRate === 'number' && !isNaN(sound.playbackRate) ? sound.playbackRate : 1));
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(gainNode);
    let resolveEnded;
    const endedPromise = new Promise(function (r) { resolveEnded = r; });
    src.onended = () => {
      const i = activeSources.findIndex((e) => e.src === src);
      if (i !== -1) {
        const entry = activeSources[i];
        activeSources.splice(i, 1);
        if (entry.sound && entry.sound.loop) {
          playSound(entry.sound);
        } else {
          resolveEnded(true);
        }
      }
    };

    pruneOldestActive();
    activeSources.push({ src, soundId: sound.id, sound });
    src.start(0, startSec, duration);
    return endedPromise;
  });
}

function preloadSounds(sounds, count = PRELOAD_COUNT) {
  const list = Array.isArray(sounds) ? sounds.slice(0, count) : [];
  list.forEach((s) => { if (s && s.fileUrl) loadBuffer(s.fileUrl); });
}

function clearCache() {
  audioCache.clear();
  normGainCache.clear();
}

function setMasterVolume(v) {
  const n = parseFloat(v);
  masterVolume = typeof n === 'number' && !isNaN(n) ? Math.max(0, Math.min(1, n)) : 1;
  const c = getContext();
  if (c && masterGainNode) masterGainNode.gain.setValueAtTime(masterVolume, c.currentTime);
}

function getMasterVolume() {
  return masterVolume;
}

function setAutoLevelEnabled(enabled) {
  autoLevelEnabled = !!enabled;
}

function getAutoLevelEnabled() {
  return autoLevelEnabled;
}

function setCompressorEnabled(enabled) {
  compressorEnabled = !!enabled;
  ensureMasterChain();
  applyCompressorSettings(compressorEnabled);
}

function getCompressorEnabled() {
  return compressorEnabled;
}

function getDurationSeconds(fileUrl) {
  const buf = audioCache.get(fileUrl);
  return buf && typeof buf.duration === 'number' ? buf.duration : null;
}

window.SoundboardAudio = {
  getContext,
  loadBuffer,
  playSound,
  stopSound,
  preloadSounds,
  clearCache,
  setMasterVolume,
  getMasterVolume,
  setAutoLevelEnabled,
  getAutoLevelEnabled,
  setCompressorEnabled,
  getCompressorEnabled,
  analyzeFileUrl,
  getDurationSeconds,
  NORM_ALGO_VERSION,
  TARGET_LUFS,
  MAX_SIMULTANEOUS_SOUNDS,
  PRELOAD_COUNT
};

/**
 * audio-engine.js — Web Audio API: load, cache, play with trim and volume.
 * Pipeline: AudioContext → fetch/decode → AudioBuffer → BufferSource → GainNode → destination
 */

const MAX_SIMULTANEOUS_SOUNDS = 6;
const PRELOAD_COUNT = 10;
const MASTER_VOLUME_MIN = 0;
/** Gain at 100% slider — matches the previous “200% boost” level. */
const MASTER_VOLUME_BASE_GAIN = 2;
/** Gain at 200% slider — 200% of the new base. */
const MASTER_VOLUME_MAX_GAIN = 4;
const MASTER_VOLUME_MAX = MASTER_VOLUME_MAX_GAIN;

let ctx = null;
let masterVolume = MASTER_VOLUME_BASE_GAIN;
let autoLevelEnabled = true;
let masterGainNode = null;
let compressorNode = null;
const audioCache = new Map();
const normGainCache = new Map(); // fileUrl -> gain
const activeSources = [];
/** Tracks modal preview for live in/out marking. */
let previewSession = null;
/** Bumped when all board sounds are stopped so async loads cannot start stale plays. */
let boardPlayGeneration = 0;

function getEffectiveRate(sound) {
  const Tempo = window.SoundboardTempo;
  if (Tempo && Tempo.computeEffectivePlaybackRate) {
    return Tempo.computeEffectivePlaybackRate(sound);
  }
  const r = sound && sound.playbackRate != null ? sound.playbackRate : 1;
  return Math.max(0.25, Math.min(4, typeof r === 'number' && !isNaN(r) ? r : 1));
}

function getContext() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  ctx.onstatechange = function () {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      try {
        window.dispatchEvent(new CustomEvent('soundboard-audio-state', { detail: { state: ctx.state } }));
      } catch (_) {}
    }
  };
  return ctx;
}

function getContextState() {
  const c = ctx || getContext();
  return c && c.state ? c.state : 'closed';
}

async function resumeContext() {
  const c = getContext();
  if (!c) return { resumed: false, state: 'closed' };
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch (e) {
      console.warn('audio-engine: resume failed', e);
      return { resumed: false, state: c.state };
    }
  }
  return { resumed: c.state === 'running', state: c.state };
}

function ensureMasterChain() {
  const c = getContext();
  if (!c) return null;
  if (masterGainNode && compressorNode) return { masterGainNode, compressorNode };

  masterGainNode = c.createGain();
  masterGainNode.gain.setValueAtTime(masterVolume, c.currentTime);

  compressorNode = c.createDynamicsCompressor();
  applyCompressorSettings(autoLevelEnabled);

  masterGainNode.connect(compressorNode);
  compressorNode.connect(c.destination);

  return { masterGainNode, compressorNode };
}

function applyCompressorSettings(enabled) {
  const c = getContext();
  if (!c || !compressorNode) return;
  const comp = compressorNode;
  if (enabled) {
    // Gentle “safety net” compression: reduces harsh peaks without pumping too much.
    comp.threshold.setValueAtTime(-18, c.currentTime);
    comp.knee.setValueAtTime(24, c.currentTime);
    comp.ratio.setValueAtTime(3, c.currentTime);
    comp.attack.setValueAtTime(0.003, c.currentTime);
    comp.release.setValueAtTime(0.25, c.currentTime);
  } else {
    // Near-bypass (not perfect, but avoids reconnect pops).
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

function clampMasterVolume(v) {
  const n = parseFloat(v);
  if (typeof n !== 'number' || isNaN(n)) return MASTER_VOLUME_BASE_GAIN;
  return Math.max(MASTER_VOLUME_MIN, Math.min(MASTER_VOLUME_MAX_GAIN, n));
}

function masterPercentToGain(pct) {
  const p = typeof pct === 'number' && !isNaN(pct) ? pct : 100;
  return clampMasterVolume((p / 100) * MASTER_VOLUME_BASE_GAIN);
}

function masterGainToPercent(gain) {
  const g = typeof gain === 'number' && !isNaN(gain) ? gain : MASTER_VOLUME_BASE_GAIN;
  return Math.round((g / MASTER_VOLUME_BASE_GAIN) * 100);
}

function setMasterVolumeFromPercent(pct) {
  setMasterVolume(masterPercentToGain(pct));
}

async function loadBuffer(fileUrl) {
  const c = getContext();
  if (!c) return null;
  if (c.state === 'suspended') {
    try { await c.resume(); } catch (e) { console.warn('audio-engine: resume on load failed', e); }
  }
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
  if (!soundId) boardPlayGeneration += 1;
  for (let i = activeSources.length - 1; i >= 0; i--) {
    const entry = activeSources[i];
    if (!soundId || entry.soundId === soundId) {
      entry.stopRequested = true;
      try { entry.src.stop(); } catch (_) {}
      activeSources.splice(i, 1);
    }
  }
  if (!soundId || soundId === 'preview') previewSession = null;
}

function getPreviewPlaybackSec() {
  if (!previewSession) return null;
  const c = getContext();
  if (!c) return null;
  const elapsed = (c.currentTime - previewSession.startContextTime) * previewSession.rate;
  const pos = previewSession.startSec + elapsed;
  return Math.max(previewSession.startSec, Math.min(previewSession.endSec, pos));
}

function isPreviewPlaying() {
  return !!previewSession;
}

async function detectTempoForUrl(fileUrl) {
  const buf = await loadBuffer(fileUrl);
  if (!buf) return null;
  const Tempo = window.SoundboardTempo;
  if (!Tempo || !Tempo.detectBpmFromBuffer) return null;
  return Tempo.detectBpmFromBuffer(buf);
}

function computeNormalizationFromBuffer(buffer) {
  if (!buffer) return null;
  const channels = buffer.numberOfChannels || 0;
  if (!channels) return null;
  const length = buffer.length || 0;
  if (!length) return null;

  // Sample the buffer to avoid heavy CPU on long clips.
  const targetSamples = 20000;
  const step = Math.max(1, Math.floor(length / targetSamples));

  let sumSq = 0;
  let count = 0;
  let peak = 0;

  // Use channel 0 as baseline, but include others by averaging.
  const data = [];
  for (let ch = 0; ch < channels; ch++) data.push(buffer.getChannelData(ch));

  for (let i = 0; i < length; i += step) {
    let v = 0;
    for (let ch = 0; ch < channels; ch++) v += data[ch][i] || 0;
    v = v / channels;
    const av = Math.abs(v);
    if (av > peak) peak = av;
    sumSq += v * v;
    count++;
  }

  if (!count) return null;
  const rms = Math.sqrt(sumSq / count);
  const eps = 1e-8;
  const rmsDb = 20 * Math.log10(Math.max(eps, rms));
  const peakDb = 20 * Math.log10(Math.max(eps, peak));

  const targetRmsDb = -18;
  let gainDb = targetRmsDb - rmsDb;

  // Clamp boosts/cuts to keep things sane.
  gainDb = Math.max(-12, Math.min(12, gainDb));

  // Prevent clipping: ensure peak after gain stays below -1 dBFS.
  const peakAfterDb = peakDb + gainDb;
  if (peakAfterDb > -1) gainDb -= (peakAfterDb - (-1));

  const gain = Math.pow(10, gainDb / 20);
  return { gain, gainDb, rmsDb, peakDb };
}

function analyzeFileUrl(fileUrl) {
  if (!fileUrl) return Promise.resolve(null);
  if (normGainCache.has(fileUrl)) {
    return Promise.resolve({ gain: normGainCache.get(fileUrl), algoVersion: 1 });
  }
  return loadBuffer(fileUrl).then((buffer) => {
    if (!buffer) return null;
    const res = computeNormalizationFromBuffer(buffer);
    if (!res || typeof res.gain !== 'number' || !isFinite(res.gain)) return null;
    normGainCache.set(fileUrl, res.gain);
    return { ...res, algoVersion: 1 };
  });
}

function playSound(sound) {
  if (!sound || !sound.fileUrl) return Promise.resolve(false);
  const c = getContext();
  if (!c) return Promise.resolve(false);
  const chain = ensureMasterChain();
  if (!chain) return Promise.resolve(false);
  const isPreview = sound.id === 'preview';
  const playGeneration = isPreview ? null : boardPlayGeneration;

  return resumeContext().then(() => {
    if (!isPreview && playGeneration !== boardPlayGeneration) return null;
    return loadBuffer(sound.fileUrl);
  }).then((buffer) => {
    if (!buffer) return false;
    if (!isPreview && playGeneration !== boardPlayGeneration) return false;
    const perSound = clampVolume(sound.volume != null ? sound.volume : 1);
    let normGain = 1;
    if (autoLevelEnabled) {
      const fromExtra = sound && sound.extra && typeof sound.extra.normGain === 'number' && isFinite(sound.extra.normGain)
        ? sound.extra.normGain
        : null;
      if (fromExtra != null) {
        normGain = Math.max(0, Math.min(6, fromExtra));
      } else if (normGainCache.has(sound.fileUrl)) {
        normGain = Math.max(0, Math.min(6, normGainCache.get(sound.fileUrl)));
      } else {
        // Non-blocking: compute for this session; persistence is handled by "Analyze all".
        analyzeFileUrl(sound.fileUrl).catch(function () {});
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

    const rate = getEffectiveRate(sound);
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(gainNode);
    let resolveEnded;
    const endedPromise = new Promise(function (r) { resolveEnded = r; });
    const entry = { src, soundId: sound.id, sound, stopRequested: false };
    src.onended = () => {
      const i = activeSources.findIndex((e) => e.src === src);
      if (i !== -1) {
        const activeEntry = activeSources[i];
        activeSources.splice(i, 1);
        if (isPreview) previewSession = null;
        if (activeEntry.stopRequested) {
          resolveEnded(false);
          return;
        }
        if (activeEntry.sound && activeEntry.sound.loop) {
          playSound(activeEntry.sound);
        } else {
          resolveEnded(true);
        }
      }
    };

    pruneOldestActive();
    activeSources.push(entry);
    const startContextTime = c.currentTime;
    src.start(0, startSec, duration);
    if (isPreview) {
      previewSession = {
        startContextTime,
        startSec,
        endSec,
        rate,
        durationSec: buffer.duration
      };
    }
    return endedPromise;
  });
}

/**
 * Preview with optional loop until stopped (for tap in/out marking).
 */
function playPreviewSound(sound, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const withLoop = opts.loop !== false;
  const previewSound = Object.assign({}, sound, { id: 'preview', loop: withLoop });
  stopSound('preview');
  return playSound(previewSound);
}

function preloadSounds(sounds, count = PRELOAD_COUNT) {
  const list = Array.isArray(sounds) ? sounds.slice(0, count) : [];
  list.forEach((s) => { if (s && s.fileUrl) loadBuffer(s.fileUrl); });
}

function preloadAllSounds(sounds) {
  const list = Array.isArray(sounds) ? sounds : [];
  return Promise.all(list.map((s) => (s && s.fileUrl ? loadBuffer(s.fileUrl) : Promise.resolve(null))));
}

function clearCache() {
  audioCache.clear();
  normGainCache.clear();
}

async function reinitializeAudio(options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.clearCache) clearCache();
  stopSound();
  ensureMasterChain();
  const result = await resumeContext();
  return result;
}

function setMasterVolume(v) {
  masterVolume = clampMasterVolume(v);
  const c = getContext();
  if (c && masterGainNode) masterGainNode.gain.setValueAtTime(masterVolume, c.currentTime);
}

function getMasterVolume() {
  return masterVolume;
}

function getMasterVolumeMax() {
  return MASTER_VOLUME_MAX_GAIN;
}

function getMasterVolumeBaseGain() {
  return MASTER_VOLUME_BASE_GAIN;
}

function setAutoLevelEnabled(enabled) {
  autoLevelEnabled = !!enabled;
  ensureMasterChain();
  applyCompressorSettings(autoLevelEnabled);
}

function getAutoLevelEnabled() {
  return autoLevelEnabled;
}

function getDurationSeconds(fileUrl) {
  const buf = audioCache.get(fileUrl);
  return buf && typeof buf.duration === 'number' ? buf.duration : null;
}

window.SoundboardAudio = {
  getContext,
  getContextState,
  resumeContext,
  reinitializeAudio,
  loadBuffer,
  playSound,
  playPreviewSound,
  getPreviewPlaybackSec,
  isPreviewPlaying,
  detectTempoForUrl,
  getEffectiveRate,
  stopSound,
  preloadSounds,
  preloadAllSounds,
  clearCache,
  setMasterVolume,
  setMasterVolumeFromPercent,
  masterPercentToGain,
  masterGainToPercent,
  getMasterVolume,
  getMasterVolumeMax,
  getMasterVolumeBaseGain,
  setAutoLevelEnabled,
  getAutoLevelEnabled,
  analyzeFileUrl,
  getDurationSeconds,
  MAX_SIMULTANEOUS_SOUNDS,
  PRELOAD_COUNT,
  MASTER_VOLUME_BASE_GAIN,
  MASTER_VOLUME_MAX_GAIN
};

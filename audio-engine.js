/**
 * audio-engine.js — Web Audio API: load, cache, play with trim and volume.
 * Pipeline: AudioContext → fetch/decode → AudioBuffer → BufferSource → GainNode → destination
 */

const MAX_SIMULTANEOUS_SOUNDS = 6;
const PRELOAD_COUNT = 10;

let ctx = null;
let masterVolume = 1;
let autoLevelEnabled = true;
let masterGainNode = null;
let compressorNode = null;
const audioCache = new Map();
const normGainCache = new Map(); // fileUrl -> gain
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

  return loadBuffer(sound.fileUrl).then((buffer) => {
    if (!buffer) return false;
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
  loadBuffer,
  playSound,
  stopSound,
  preloadSounds,
  clearCache,
  setMasterVolume,
  getMasterVolume,
  setAutoLevelEnabled,
  getAutoLevelEnabled,
  analyzeFileUrl,
  getDurationSeconds,
  MAX_SIMULTANEOUS_SOUNDS,
  PRELOAD_COUNT
};

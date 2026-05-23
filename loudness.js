/**
 * loudness.js — ITU-R BS.1770 integrated loudness (LUFS) for AudioBuffer.
 * Supports 44.1 kHz and 48 kHz. Mono/stereo; averages >2ch to stereo pair.
 */

const LOUDNESS_ALGO_VERSION = 2;
const BLOCK_MS = 400;
const BLOCK_OVERLAP = 0.75;
const ABS_GATE_LU = -70;
const REL_GATE_LU = 10;

const K_WEIGHT = {
  48000: {
    shelf: { b: [1.53512485958697, -2.69169618940638, 1.19839281259985], a: [1, -1.69065929318241, 0.73248077421585] },
    hp: { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] }
  },
  44100: {
    shelf: { b: [1.66365511384102, -2.82286999940241, 1.21435581996113], a: [1, -1.73972500229124, 0.77560887969382] },
    hp: { b: [1, -2, 1], a: [1, -1.99005200506473, 0.99006276487032] }
  }
};

function getKWeight(sampleRate) {
  if (K_WEIGHT[sampleRate]) return K_WEIGHT[sampleRate];
  if (sampleRate > 44100) return K_WEIGHT[48000];
  return K_WEIGHT[44100];
}

function applyBiquad(input, coeffs) {
  const b = coeffs.b;
  const a = coeffs.a;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const b0 = b[0];
  const b1 = b[1];
  const b2 = b[2];
  const a0 = a[0];
  const a1 = a[1];
  const a2 = a[2];
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

function kWeightChannel(data, sampleRate) {
  const w = getKWeight(sampleRate);
  return applyBiquad(applyBiquad(data, w.shelf), w.hp);
}

function sliceChannel(data, startSample, endSample) {
  const s = Math.max(0, startSample);
  const e = Math.min(data.length, endSample);
  if (e <= s) return new Float32Array(0);
  return data.subarray(s, e);
}

function blockLoudness(meanSquare) {
  if (meanSquare <= 0) return -Infinity;
  return -0.691 + 10 * Math.log10(meanSquare);
}

function integratedLoudnessFromBlocks(blockLufs) {
  const valid = blockLufs.filter((x) => isFinite(x) && x > ABS_GATE_LU);
  if (valid.length === 0) return -Infinity;

  const ungatedMs = valid.reduce((s, l) => s + Math.pow(10, (l + 0.691) / 10), 0) / valid.length;
  const ungated = blockLoudness(ungatedMs);

  const relThreshold = Math.max(ABS_GATE_LU, ungated - REL_GATE_LU);
  const gated = blockLufs.filter((l) => isFinite(l) && l >= relThreshold);
  if (gated.length === 0) return ungated;

  const ms = gated.reduce((s, l) => s + Math.pow(10, (l + 0.691) / 10), 0) / gated.length;
  return blockLoudness(ms);
}

/**
 * @param {AudioBuffer} buffer
 * @param {{ startSec?: number, endSec?: number }} [range]
 * @returns {{ lufs: number, truePeak: number, truePeakDb: number }}
 */
function measureLoudness(buffer, range) {
  if (!buffer || !buffer.length) {
    return { lufs: -Infinity, truePeak: 0, truePeakDb: -Infinity };
  }

  const sampleRate = buffer.sampleRate || 48000;
  const startSec = range && typeof range.startSec === 'number' ? range.startSec : 0;
  const endSec = range && typeof range.endSec === 'number' ? range.endSec : buffer.duration;
  const startSample = Math.floor(Math.max(0, startSec) * sampleRate);
  const endSample = Math.floor(Math.min(buffer.duration, endSec) * sampleRate);

  const channels = buffer.numberOfChannels || 1;
  const weighted = [];
  let truePeak = 0;

  for (let ch = 0; ch < Math.min(channels, 2); ch++) {
    const slice = sliceChannel(buffer.getChannelData(ch), startSample, endSample);
    if (!slice.length) continue;
    const kw = kWeightChannel(slice, sampleRate);
    weighted.push(kw);
    for (let i = 0; i < kw.length; i++) {
      const av = Math.abs(kw[i]);
      if (av > truePeak) truePeak = av;
    }
  }

  if (channels > 2 && weighted.length === 2) {
    // Additional channels folded into stereo mean for simplicity.
    for (let ch = 2; ch < channels; ch++) {
      const slice = sliceChannel(buffer.getChannelData(ch), startSample, endSample);
      const kw = kWeightChannel(slice, sampleRate);
      for (let i = 0; i < kw.length; i++) {
        const av = Math.abs(kw[i]);
        if (av > truePeak) truePeak = av;
      }
    }
  }

  if (!weighted.length) {
    return { lufs: -Infinity, truePeak: 0, truePeakDb: -Infinity };
  }

  const len = weighted[0].length;
  const blockSamples = Math.max(1, Math.round((BLOCK_MS / 1000) * sampleRate));
  const stepSamples = Math.max(1, Math.round(blockSamples * (1 - BLOCK_OVERLAP)));
  const blockLufs = [];

  for (let start = 0; start < len; start += stepSamples) {
    const end = Math.min(len, start + blockSamples);
    if (end - start < Math.round(0.1 * blockSamples)) break;
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      let z = 0;
      for (let c = 0; c < weighted.length; c++) {
        const v = weighted[c][i] || 0;
        z += v * v;
      }
      z /= weighted.length;
      sum += z;
      count++;
    }
    if (count) blockLufs.push(blockLoudness(sum / count));
  }

  const lufs = integratedLoudnessFromBlocks(blockLufs);
  const eps = 1e-12;
  const truePeakDb = 20 * Math.log10(Math.max(eps, truePeak));
  return { lufs, truePeak, truePeakDb };
}

/**
 * Compute normalization gain for target LUFS with peak ceiling.
 * @param {AudioBuffer} buffer
 * @param {{ startSec?: number, endSec?: number, targetLufs?: number, peakCeilingDb?: number, maxGainDb?: number, minGainDb?: number }} opts
 */
function computeNormalizationGain(buffer, opts) {
  const targetLufs = opts && opts.targetLufs != null ? opts.targetLufs : -14;
  const peakCeilingDb = opts && opts.peakCeilingDb != null ? opts.peakCeilingDb : -1;
  const maxGainDb = opts && opts.maxGainDb != null ? opts.maxGainDb : 12;
  const minGainDb = opts && opts.minGainDb != null ? opts.minGainDb : -12;

  const range = {
    startSec: opts && opts.startSec,
    endSec: opts && opts.endSec
  };
  const { lufs, truePeakDb } = measureLoudness(buffer, range);

  if (!isFinite(lufs) || lufs <= ABS_GATE_LU) {
    return { gain: 1, gainDb: 0, lufs, truePeakDb, algoVersion: LOUDNESS_ALGO_VERSION };
  }

  let gainDb = targetLufs - lufs;
  gainDb = Math.max(minGainDb, Math.min(maxGainDb, gainDb));

  const peakAfterDb = truePeakDb + gainDb;
  if (peakAfterDb > peakCeilingDb) gainDb -= (peakAfterDb - peakCeilingDb);

  const gain = Math.pow(10, gainDb / 20);
  return { gain, gainDb, lufs, truePeakDb, algoVersion: LOUDNESS_ALGO_VERSION };
}

window.SoundboardLoudness = {
  LOUDNESS_ALGO_VERSION,
  measureLoudness,
  computeNormalizationGain
};

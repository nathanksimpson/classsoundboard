/**
 * tempo-analysis.js — BPM estimation and beat-grid snapping (no external deps).
 */

function downsampleEnvelope(channelData, sampleRate, targetHz) {
  const step = Math.max(1, Math.floor(sampleRate / targetHz));
  const env = [];
  for (let i = 0; i < channelData.length; i += step) {
    let peak = 0;
    const end = Math.min(channelData.length, i + step);
    for (let j = i; j < end; j++) {
      const v = Math.abs(channelData[j] || 0);
      if (v > peak) peak = v;
    }
    env.push(peak);
  }
  return { env, envSampleRate: sampleRate / step };
}

function findPeaks(values, threshold, minDistance) {
  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] < threshold) continue;
    if (values[i] >= values[i - 1] && values[i] > values[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
        peaks.push(i);
      }
    }
  }
  return peaks;
}

/**
 * Estimate BPM from an AudioBuffer. Returns null if unreliable.
 */
function detectBpmFromBuffer(buffer) {
  if (!buffer || !buffer.length) return null;
  const channels = buffer.numberOfChannels || 0;
  if (!channels) return null;

  const sampleRate = buffer.sampleRate || 44100;
  const length = buffer.length;
  const mix = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mix[i] += (data[i] || 0) / channels;
  }

  const { env, envSampleRate } = downsampleEnvelope(mix, sampleRate, 200);
  if (env.length < 40) return null;

  let max = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > max) max = env[i];
  if (max < 1e-6) return null;

  const threshold = max * 0.35;
  const minDistance = Math.max(2, Math.floor(envSampleRate * 0.25));
  const peaks = findPeaks(env, threshold, minDistance);
  if (peaks.length < 4) return null;

  const intervals = [];
  for (let i = 1; i < peaks.length; i++) {
    const dt = (peaks[i] - peaks[i - 1]) / envSampleRate;
    if (dt >= 0.25 && dt <= 2.0) intervals.push(dt);
  }
  if (intervals.length < 3) return null;

  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  let bpm = 60 / median;

  while (bpm < 70) bpm *= 2;
  while (bpm > 190) bpm /= 2;

  if (!Number.isFinite(bpm) || bpm < 60 || bpm > 200) return null;
  return Math.round(bpm * 10) / 10;
}

function snapSecToBeat(sec, bpm, beatOffsetSec) {
  if (!Number.isFinite(sec) || !Number.isFinite(bpm) || bpm <= 0) return sec;
  const beatDur = 60 / bpm;
  const phase = Number.isFinite(beatOffsetSec) ? beatOffsetSec : 0;
  const n = Math.round((sec - phase) / beatDur);
  return Math.max(0, phase + n * beatDur);
}

function semitonesToPlaybackRate(semitones) {
  const n = typeof semitones === 'number' && !isNaN(semitones) ? semitones : 0;
  return Math.pow(2, n / 12);
}

/**
 * Combined playback rate: pitch (semitones) × tempo (project/detected BPM) × legacy speed.
 */
function computeEffectivePlaybackRate(sound) {
  if (!sound || typeof sound !== 'object') return 1;
  const extra = sound.extra && typeof sound.extra === 'object' ? sound.extra : {};
  let rate = 1;

  if (typeof extra.pitchSemitones === 'number' && isFinite(extra.pitchSemitones)) {
    rate *= semitonesToPlaybackRate(extra.pitchSemitones);
  }

  const detected = extra.detectedBpm != null ? Number(extra.detectedBpm) : (extra.bpm != null ? Number(extra.bpm) : null);
  const project = extra.projectBpm != null ? Number(extra.projectBpm) : null;
  if (detected > 0 && project > 0) {
    rate *= project / detected;
  }

  if (sound.playbackRate != null && typeof sound.playbackRate === 'number' && isFinite(sound.playbackRate)) {
    rate *= sound.playbackRate;
  }

  return Math.max(0.25, Math.min(4, rate));
}

window.SoundboardTempo = {
  detectBpmFromBuffer,
  snapSecToBeat,
  semitonesToPlaybackRate,
  computeEffectivePlaybackRate
};

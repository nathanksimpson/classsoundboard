/**
 * Node smoke tests for loudness.js (no AudioContext required).
 * Run: node tests/run-loudness-tests.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loudnessPath = join(__dirname, '..', 'loudness.js');
const code = readFileSync(loudnessPath, 'utf8');

const sandbox = { window: {}, console, Math, Float32Array, isFinite };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const { measureLoudness, computeNormalizationGain } = sandbox.window.SoundboardLoudness;

function makeBuffer(sampleRate, channelData) {
  const length = channelData[0].length;
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channelData.length,
    getChannelData(i) { return channelData[i]; }
  };
}

function makeSine(sampleRate, seconds, freq, amplitude) {
  const n = Math.floor(sampleRate * seconds);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    data[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return data;
}

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed++;
    console.log('  ok', name);
  } else {
    failed++;
    console.error(' FAIL', name);
  }
}

// -20 dBFS sine ~1s → boosting toward -14 LUFS should need positive gain
const sr = 48000;
const amp = Math.pow(10, -20 / 20) * 0.707;
const sine = makeSine(sr, 1, 1000, amp);
const buf = makeBuffer(sr, [sine, sine]);
const norm = computeNormalizationGain(buf, { targetLufs: -14 });
assert('gainDb in sane range', norm.gainDb > 0 && norm.gainDb <= 12);
assert('gain linear matches gainDb', Math.abs(norm.gain - Math.pow(10, norm.gainDb / 20)) < 0.001);

// Peak limiting: hot signal should not exceed ceiling after norm
const hot = makeSine(sr, 0.5, 440, 0.95);
const hotBuf = makeBuffer(sr, [hot, hot]);
const hotNorm = computeNormalizationGain(hotBuf, { targetLufs: -14, peakCeilingDb: -1 });
const peakAfter = hotNorm.truePeakDb + hotNorm.gainDb;
assert('peak after gain <= -1 dB', peakAfter <= -1 + 0.01);

// Trim range: loud segment only in second half
const quiet = makeSine(sr, 0.5, 440, 0.01);
const loud = makeSine(sr, 0.5, 440, 0.5);
const combined = new Float32Array(quiet.length + loud.length);
combined.set(quiet, 0);
combined.set(loud, quiet.length);
const combBuf = makeBuffer(sr, [combined, combined]);
const full = measureLoudness(combBuf, {});
const trimmed = measureLoudness(combBuf, { startSec: 0.5, endSec: 1 });
assert('trim changes measured lufs', Math.abs(full.lufs - trimmed.lufs) > 0.5);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

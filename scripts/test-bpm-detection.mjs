import { analyzeOfflineTempo } from '../src/audio/tempoAnalysis.mjs'

const SAMPLE_RATE = 44100

function sineBurst(length, frequency, amplitude = 1) {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const env = Math.exp(-4.5 * i / length)
    out[i] = Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) * amplitude * env
  }
  return out
}

function noiseBurst(length, amplitude = 1) {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const env = Math.exp(-8 * i / length)
    out[i] = (Math.random() * 2 - 1) * amplitude * env
  }
  return out
}

function addBurst(target, start, burst) {
  for (let i = 0; i < burst.length; i++) {
    const idx = start + i
    if (idx >= 0 && idx < target.length) {
      target[idx] += burst[i]
    }
  }
}

function synthesizeTrack({ bpm, seconds = 24, pattern = 'four-on-floor' }) {
  const totalSamples = Math.floor(seconds * SAMPLE_RATE)
  const samples = new Float32Array(totalSamples)
  const beatSamples = (60 / bpm) * SAMPLE_RATE
  const barSamples = beatSamples * 4

  const kick = sineBurst(Math.floor(SAMPLE_RATE * 0.12), 62, 0.95)
  const snareBody = sineBurst(Math.floor(SAMPLE_RATE * 0.09), 190, 0.4)
  const snareNoise = noiseBurst(Math.floor(SAMPLE_RATE * 0.08), 0.45)
  const hat = noiseBurst(Math.floor(SAMPLE_RATE * 0.03), 0.16)
  const bass = sineBurst(Math.floor(SAMPLE_RATE * 0.22), 110, 0.18)

  for (let n = 0; n < totalSamples; n += Math.floor(SAMPLE_RATE / 200)) {
    const t = n / SAMPLE_RATE
    samples[n] += Math.sin(2 * Math.PI * 55 * t) * 0.02
  }

  for (let start = 0; start < totalSamples; start += Math.floor(barSamples)) {
    if (pattern === 'four-on-floor') {
      for (let beat = 0; beat < 4; beat++) {
        addBurst(samples, start + Math.floor(beat * beatSamples), kick)
        addBurst(samples, start + Math.floor((beat + 0.5) * beatSamples), hat)
      }
      addBurst(samples, start + Math.floor(beatSamples), snareBody)
      addBurst(samples, start + Math.floor(beatSamples), snareNoise)
      addBurst(samples, start + Math.floor(3 * beatSamples), snareBody)
      addBurst(samples, start + Math.floor(3 * beatSamples), snareNoise)
    } else if (pattern === 'hiphop') {
      addBurst(samples, start, kick)
      addBurst(samples, start + Math.floor(1.5 * beatSamples), snareNoise)
      addBurst(samples, start + Math.floor(2 * beatSamples), kick)
      addBurst(samples, start + Math.floor(3 * beatSamples), snareBody)
      addBurst(samples, start + Math.floor(3 * beatSamples), snareNoise)
      for (let step = 0; step < 8; step++) {
        addBurst(samples, start + Math.floor(step * beatSamples / 2), hat)
      }
    } else if (pattern === 'dnb') {
      addBurst(samples, start, kick)
      addBurst(samples, start + Math.floor(1.75 * beatSamples), snareBody)
      addBurst(samples, start + Math.floor(1.75 * beatSamples), snareNoise)
      addBurst(samples, start + Math.floor(2.5 * beatSamples), kick)
      for (let step = 0; step < 16; step++) {
        addBurst(samples, start + Math.floor(step * beatSamples / 4), hat)
      }
    }

    addBurst(samples, start, bass)
    addBurst(samples, start + Math.floor(2 * beatSamples), bass)
  }

  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.max(-1, Math.min(1, samples[i]))
  }

  return samples
}

const cases = [
  { name: 'house-120', bpm: 120, pattern: 'four-on-floor' },
  { name: 'edm-128', bpm: 128, pattern: 'four-on-floor' },
  { name: 'hiphop-94', bpm: 94, pattern: 'hiphop' },
  { name: 'house-140', bpm: 140, pattern: 'four-on-floor' },
  { name: 'techno-150', bpm: 150, pattern: 'four-on-floor' },
]

let failures = 0
const results = []
for (const testCase of cases) {
  const samples = synthesizeTrack(testCase)
  const result = analyzeOfflineTempo(samples, SAMPLE_RATE)
  const detected = result?.bpm ?? 0
  const error = Math.abs(detected - testCase.bpm)
  const pass = error <= 2
  if (!pass) failures++
  results.push({
    name: testCase.name,
    expected: testCase.bpm,
    detected,
    error: Number(error.toFixed(2)),
    intervalTempo: result?.intervalTempo ?? null,
    onsetSignalTempo: result?.onsetSignalTempo ?? null,
    pass,
  })
}

console.table(results)
if (failures > 0) {
  process.exitCode = 1
}

import { createDropDetector } from '../src/audio/dropDetector.js'

const FRAME_MS = 100

function mulberry32(seed) {
  let t = seed >>> 0
  return function next() {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function alignToFrame(ms) {
  return Math.round(ms / FRAME_MS) * FRAME_MS
}

function buildDropPositiveCase({
  name,
  bpm,
  seed,
  expectedPath = 'primary',
  weakBeatAtDrop = false,
}) {
  const rand = mulberry32(seed)
  const beatInterval = 60000 / bpm
  const durationMs = 22000
  const dropAtMs = alignToFrame(beatInterval * 24)
  const dipStartMs = dropAtMs - 700
  const dipEndMs = dropAtMs - 300

  const frames = []
  for (let nowMs = 0; nowMs <= durationMs; nowMs += FRAME_MS) {
    const nearestBeatDistance = Math.abs(nowMs - Math.round(nowMs / beatInterval) * beatInterval)
    const isOnset = nearestBeatDistance <= 55

    const baseEnergy = nowMs < dropAtMs
      ? 0.071 + (isOnset ? 0.008 : 0)
      : 0.086 + (isOnset ? 0.014 : 0)
    const baseLow = nowMs < dropAtMs
      ? 0.048 + (isOnset ? 0.006 : 0)
      : 0.069 + (isOnset ? 0.012 : 0)

    let energy = baseEnergy + (rand() - 0.5) * 0.004
    let lowBandEnergy = baseLow + (rand() - 0.5) * 0.003

    if (nowMs >= dipStartMs && nowMs <= dipEndMs) {
      energy = 0.034 + (rand() - 0.5) * 0.002
      lowBandEnergy = 0.022 + (rand() - 0.5) * 0.001
    }

    const inDropBurst = expectedPath === 'fallback'
      ? nowMs >= dropAtMs && nowMs <= (dropAtMs + FRAME_MS)
      : nowMs === dropAtMs

    if (inDropBurst) {
      energy = 0.168 + (rand() - 0.5) * 0.003
      lowBandEnergy = 0.125 + (rand() - 0.5) * 0.003
    }

    let beatLockStrength = nowMs < dropAtMs ? 0.74 : 0.68
    let tempoLocked = true
    if (weakBeatAtDrop && nowMs >= dropAtMs && nowMs <= (dropAtMs + FRAME_MS)) {
      beatLockStrength = 0.28
      tempoLocked = false
    }

    const onsetThreshold = 0.02
    let onsetStrength = isOnset ? 0.046 : 0.013
    if (inDropBurst) {
      onsetStrength = 0.061
    }

    frames.push({
      nowMs,
      bpm,
      energy,
      lowBandEnergy,
      isOnset,
      onsetStrength,
      onsetThreshold,
      beatLockStrength,
      tempoLocked,
    })
  }

  return {
    name,
    type: 'positive',
    expectedPath,
    dropAtMs,
    durationMs,
    frames,
  }
}

function buildSteadyNegativeCase({ name, bpm, seed, durationMs = 180000 }) {
  const rand = mulberry32(seed)
  const beatInterval = 60000 / bpm
  const frames = []

  for (let nowMs = 0; nowMs <= durationMs; nowMs += FRAME_MS) {
    const nearestBeatDistance = Math.abs(nowMs - Math.round(nowMs / beatInterval) * beatInterval)
    const isOnset = nearestBeatDistance <= 55
    const slowMod = Math.sin((2 * Math.PI * nowMs) / 9000) * 0.002

    const energy = 0.078 + slowMod + (isOnset ? 0.006 : 0) + (rand() - 0.5) * 0.004
    const lowBandEnergy = 0.053 + slowMod * 0.8 + (isOnset ? 0.004 : 0) + (rand() - 0.5) * 0.003

    frames.push({
      nowMs,
      bpm,
      energy,
      lowBandEnergy,
      isOnset,
      onsetStrength: isOnset ? 0.037 : 0.012,
      onsetThreshold: 0.02,
      beatLockStrength: 0.69,
      tempoLocked: true,
    })
  }

  return {
    name,
    type: 'negative',
    durationMs,
    frames,
  }
}

function buildSpokenNoiseNegativeCase({ name, seed, durationMs = 180000 }) {
  const rand = mulberry32(seed)
  const frames = []

  for (let nowMs = 0; nowMs <= durationMs; nowMs += FRAME_MS) {
    const burst = (rand() > 0.985) ? 0.02 : 0
    const energy = 0.038 + (rand() - 0.5) * 0.014 + burst
    const lowBandEnergy = 0.022 + (rand() - 0.5) * 0.008 + burst * 0.25
    const onsetStrength = 0.013 + (rand() - 0.5) * 0.004 + burst * 0.4

    frames.push({
      nowMs,
      bpm: 120,
      energy,
      lowBandEnergy,
      isOnset: false,
      onsetStrength,
      onsetThreshold: 0.02,
      beatLockStrength: 0.18,
      tempoLocked: false,
    })
  }

  return {
    name,
    type: 'negative',
    durationMs,
    frames,
  }
}

function runCase(testCase) {
  const detector = createDropDetector()
  const triggers = []

  for (const frame of testCase.frames) {
    const result = detector.update(frame)
    if (result.triggered) {
      triggers.push({
        atMs: frame.nowMs,
        path: result.path,
      })
    }
  }

  if (testCase.type === 'positive') {
    const firstTrigger = triggers[0]
    const latencyMs = firstTrigger ? Math.abs(firstTrigger.atMs - testCase.dropAtMs) : null
    const latencyPass = firstTrigger ? latencyMs <= 250 : false
    const pathPass = firstTrigger ? firstTrigger.path === testCase.expectedPath : false

    return {
      name: testCase.name,
      type: testCase.type,
      expectedPath: testCase.expectedPath,
      triggered: Boolean(firstTrigger),
      triggerAtMs: firstTrigger?.atMs ?? null,
      latencyMs,
      path: firstTrigger?.path ?? null,
      pass: latencyPass && pathPass,
      triggers: triggers.length,
    }
  }

  const falsePositives = triggers.length
  const falsePosPer180s = (falsePositives * 180000) / Math.max(testCase.durationMs, 1)

  return {
    name: testCase.name,
    type: testCase.type,
    expectedPath: '-',
    triggered: falsePositives > 0,
    triggerAtMs: triggers[0]?.atMs ?? null,
    latencyMs: null,
    path: triggers[0]?.path ?? null,
    pass: falsePosPer180s <= 1,
    triggers: falsePositives,
    falsePosPer180s: Number(falsePosPer180s.toFixed(2)),
  }
}

const cases = [
  buildDropPositiveCase({ name: 'edm-primary-128', bpm: 128, seed: 101 }),
  buildDropPositiveCase({ name: 'techno-primary-134', bpm: 134, seed: 102 }),
  buildDropPositiveCase({ name: 'pop-primary-124', bpm: 124, seed: 103 }),
  buildDropPositiveCase({ name: 'rock-primary-116', bpm: 116, seed: 104 }),
  buildDropPositiveCase({ name: 'edm-fallback-128', bpm: 128, seed: 105, expectedPath: 'fallback', weakBeatAtDrop: true }),
  buildSteadyNegativeCase({ name: 'steady-groove-180s', bpm: 126, seed: 201 }),
  buildSpokenNoiseNegativeCase({ name: 'spoken-noise-180s', seed: 202 }),
]

const results = cases.map(runCase)
const positives = results.filter((r) => r.type === 'positive')
const negatives = results.filter((r) => r.type === 'negative')

const positivePasses = positives.filter((r) => r.pass).length
const recall = positives.length ? positivePasses / positives.length : 0

const totalNegativeDurationMs = cases
  .filter((c) => c.type === 'negative')
  .reduce((sum, c) => sum + c.durationMs, 0)
const totalNegativeTriggers = negatives.reduce((sum, r) => sum + r.triggers, 0)
const falsePosPer180s = totalNegativeDurationMs > 0
  ? (totalNegativeTriggers * 180000) / totalNegativeDurationMs
  : 0

console.table(results)
console.log('Drop detection metrics:')
console.log(`  Recall (positive cases): ${(recall * 100).toFixed(1)}% (target >= 80.0%)`)
console.log(`  False positives / 180s: ${falsePosPer180s.toFixed(2)} (target <= 1.00)`)

let failed = false
if (recall < 0.8) {
  console.error(`Recall target not met: ${(recall * 100).toFixed(1)}% < 80.0%`)
  failed = true
}
if (falsePosPer180s > 1) {
  console.error(`False-positive target not met: ${falsePosPer180s.toFixed(2)} > 1.00 per 180s`)
  failed = true
}

for (const positive of positives) {
  if (!positive.triggered) {
    console.error(`No drop detected for positive case: ${positive.name}`)
    failed = true
    continue
  }
  if (positive.latencyMs > 250) {
    console.error(`Latency target not met for ${positive.name}: ${positive.latencyMs}ms > 250ms`)
    failed = true
  }
  if (positive.path !== positive.expectedPath) {
    console.error(`Expected ${positive.expectedPath} path for ${positive.name} but got ${positive.path}`)
    failed = true
  }
}

if (failed) {
  process.exitCode = 1
}

/**
 * Real-time BPM + energy detector using Meyda
 *
 * Features extracted every ~93ms (bufferSize 4096 @ 44100Hz):
 * - rms           → energy/loudness
 * - energy        → frame energy
 * - spectralCentroid → brightness (higher = more treble-heavy)
 * - zcr           → zero crossing rate (transient density)
 * - loudness      → perceptual loudness bands
 *
 * Beat tracking: onset detection → interval histogram → BPM estimate
 */

import Meyda from 'meyda'

const BUFFER_SIZE = 4096
const SAMPLE_RATE = 44100
const BEAT_HISTORY_MAX = 60         // Keep last N beat intervals
const MIN_BPM = 60
const MAX_BPM = 200
const SILENCE_THRESHOLD = 0.005     // RMS below this = silence
const BPM_RESYNC_WINDOW_MS = 10000
const ENVELOPE_WINDOW_MS = 12000
const TEMPO_ESTIMATE_INTERVAL_MS = 1000
const BEAT_ACTIVE_WINDOW_MS = 1400
const BPM_LOCK_TOLERANCE = 6
const BPM_LOCK_HARD_TOLERANCE = 12

let analyzer = null
let onsetHistory = []               // timestamps of detected onsets
let envelopeHistory = []            // { t, e } envelope samples
let lastOnsetTime = 0
let smoothedBpm = 120
let smoothedEnergy = 0
let smoothedCentroid = 0
let silenceFrames = 0
let lastTempoEstimate = 0
const SILENCE_FRAMES_THRESHOLD = 30 // ~3 seconds of silence

let callback = null

export function startBPMDetector(audioContext, sourceNode, cb) {
  callback = cb
  onsetHistory = []
  envelopeHistory = []
  silenceFrames = 0
  lastOnsetTime = 0
  lastTempoEstimate = 0
  smoothedBpm = 120
  smoothedEnergy = 0
  smoothedCentroid = 0

  analyzer = Meyda.createMeydaAnalyzer({
    audioContext,
    source: sourceNode,
    bufferSize: BUFFER_SIZE,
    featureExtractors: ['rms', 'energy', 'spectralCentroid', 'zcr'],
    callback: handleFrame,
  })

  analyzer.start()
}

export function stopBPMDetector() {
  if (analyzer) {
    analyzer.stop()
    analyzer = null
  }
  onsetHistory = []
  envelopeHistory = []
  silenceFrames = 0
  lastOnsetTime = 0
  lastTempoEstimate = 0
  callback = null
}

function handleFrame(features) {
  if (!features) return

  const { rms, energy, spectralCentroid, zcr } = features
  const now = performance.now()

  // Silence detection
  if (rms < SILENCE_THRESHOLD) {
    silenceFrames++
  } else {
    silenceFrames = 0
  }

  const isSilent = silenceFrames > SILENCE_FRAMES_THRESHOLD

  // Smooth energy (exponential moving average)
  smoothedEnergy = smoothedEnergy * 0.85 + (rms || 0) * 0.15
  smoothedCentroid = smoothedCentroid * 0.9 + (spectralCentroid || 5000) * 0.1

  // Keep an energy envelope history for autocorrelation tempo estimation.
  envelopeHistory.push({ t: now, e: smoothedEnergy })
  envelopeHistory = envelopeHistory.filter((p) => (now - p.t) <= ENVELOPE_WINDOW_MS)

  // Onset detection: significant energy spike = beat candidate
  if (!isSilent && rms > smoothedEnergy * 1.4 && (now - lastOnsetTime) > 200) {
    lastOnsetTime = now
    onsetHistory.push(now)
    onsetHistory = onsetHistory.filter(ts => (now - ts) <= BPM_RESYNC_WINDOW_MS)
    if (onsetHistory.length > BEAT_HISTORY_MAX) {
      onsetHistory.shift()
    }
    const onsetBpm = estimateOnsetBPM(onsetHistory)
    if (onsetBpm) {
      const beatLockStrength = estimateBeatLockStrength(onsetHistory, smoothedBpm)
      const beatPresent = (now - lastOnsetTime) <= BEAT_ACTIVE_WINDOW_MS
      const delta = Math.abs(onsetBpm - smoothedBpm)

      let onsetWeight = 0.25
      if (beatPresent && beatLockStrength > 0.7) {
        onsetWeight = delta <= BPM_LOCK_TOLERANCE ? 0.12 : 0.03
      } else if (beatLockStrength > 0.45 && delta > BPM_LOCK_HARD_TOLERANCE) {
        onsetWeight = 0.08
      }

      smoothedBpm = smoothedBpm * (1 - onsetWeight) + onsetBpm * onsetWeight
    }
  }

  if (!isSilent && (now - lastTempoEstimate) >= TEMPO_ESTIMATE_INTERVAL_MS) {
    lastTempoEstimate = now
    const envelopeBpm = estimateEnvelopeBPM(envelopeHistory)
    if (envelopeBpm) {
      const beatLockStrength = estimateBeatLockStrength(onsetHistory, smoothedBpm)
      const beatPresent = (now - lastOnsetTime) <= BEAT_ACTIVE_WINDOW_MS
      const delta = Math.abs(envelopeBpm - smoothedBpm)

      let envelopeWeight = 0.3
      if (beatPresent && beatLockStrength > 0.7) {
        envelopeWeight = delta <= BPM_LOCK_TOLERANCE ? 0.08 : 0.02
      } else if (beatLockStrength > 0.45 && delta > BPM_LOCK_HARD_TOLERANCE) {
        envelopeWeight = 0.1
      }

      smoothedBpm = smoothedBpm * (1 - envelopeWeight) + envelopeBpm * envelopeWeight
    }
  }

  callback?.({
    bpm: Math.round(smoothedBpm),
    energy: smoothedEnergy,
    spectralCentroid: smoothedCentroid,
    rms: rms || 0,
    zcr: zcr || 0,
    isSilent,
  })
}

function estimateBeatLockStrength(timestamps, referenceBpm) {
  if (timestamps.length < 6 || !Number.isFinite(referenceBpm) || referenceBpm <= 0) return 0

  const expectedInterval = 60000 / referenceBpm
  const intervals = []
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1])
  }
  if (!intervals.length) return 0

  let coherent = 0
  for (const interval of intervals) {
    const closest = Math.min(
      Math.abs(interval - expectedInterval),
      Math.abs(interval - expectedInterval * 0.5),
      Math.abs(interval - expectedInterval * 2),
    )
    if (closest <= 45) coherent++
  }

  return coherent / intervals.length
}

function estimateOnsetBPM(timestamps) {
  if (timestamps.length < 4) return null

  // Calculate intervals between consecutive onsets
  const intervals = []
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1])
  }

  // Build a weighted histogram of BPM candidates
  const bpmCounts = {}
  for (const interval of intervals) {
    const bpm = Math.round(60000 / interval)
    // Also count half/double time
    for (const multiplier of [0.5, 1, 2]) {
      const candidate = Math.round(bpm * multiplier)
      if (candidate >= MIN_BPM && candidate <= MAX_BPM) {
        bpmCounts[candidate] = (bpmCounts[candidate] || 0) + 1
      }
    }
  }

  // Find the most common BPM candidate
  let bestBpm = null
  let bestCount = 0
  for (const [bpm, count] of Object.entries(bpmCounts)) {
    if (count > bestCount) {
      bestCount = count
      bestBpm = parseInt(bpm)
    }
  }

  if (!bestBpm) return null

  return bestBpm
}

function estimateEnvelopeBPM(points) {
  if (points.length < 32) return null

  const values = points.map((p) => p.e)
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const centered = values.map((v) => v - mean)

  const frameMs = (points[points.length - 1].t - points[0].t) / (points.length - 1)
  if (!Number.isFinite(frameMs) || frameMs <= 0) return null

  const minLag = Math.max(1, Math.round((60000 / MAX_BPM) / frameMs))
  const maxLag = Math.max(minLag + 1, Math.round((60000 / MIN_BPM) / frameMs))

  let bestLag = 0
  let bestScore = -Infinity

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0
    for (let i = lag; i < centered.length; i++) {
      score += centered[i] * centered[i - lag]
    }
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  if (bestLag <= 0 || bestScore <= 0) return null
  const bpm = 60000 / (bestLag * frameMs)
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return null

  return bpm
}

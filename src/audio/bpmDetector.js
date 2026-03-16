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

let analyzer = null
let onsetHistory = []               // timestamps of detected onsets
let lastOnsetTime = 0
let smoothedBpm = 120
let smoothedEnergy = 0
let smoothedCentroid = 0
let silenceFrames = 0
const SILENCE_FRAMES_THRESHOLD = 30 // ~3 seconds of silence

let callback = null

export function startBPMDetector(audioContext, sourceNode, cb) {
  callback = cb
  onsetHistory = []
  silenceFrames = 0
  lastOnsetTime = 0
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
  silenceFrames = 0
  lastOnsetTime = 0
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

  // Onset detection: significant energy spike = beat candidate
  if (!isSilent && rms > smoothedEnergy * 1.4 && (now - lastOnsetTime) > 200) {
    lastOnsetTime = now
    onsetHistory.push(now)
    onsetHistory = onsetHistory.filter(ts => (now - ts) <= BPM_RESYNC_WINDOW_MS)
    if (onsetHistory.length > BEAT_HISTORY_MAX) {
      onsetHistory.shift()
    }
    smoothedBpm = estimateBPM(onsetHistory) || smoothedBpm
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

function estimateBPM(timestamps) {
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

  // Smooth toward the new estimate
  return smoothedBpm * 0.7 + bestBpm * 0.3
}

/**
 * Real-time BPM + energy detector using Meyda
 *
 * Features extracted every ~93ms (bufferSize 4096 @ 44100Hz):
 * - rms              → energy/loudness
 * - energy           → frame energy
 * - spectralCentroid → brightness (higher = more treble-heavy)
 * - zcr              → zero crossing rate (transient density)
 * - spectralFlux     → frame-to-frame spectral change (onset detection)
 * - amplitudeSpectrum → per-bin magnitudes (multi-band energy)
 *
 * Beat tracking improvements:
 * - Spectral flux onset detection (much better than energy-only thresholds)
 * - Multi-band energy analysis (low/mid/high) for kick-drum detection
 * - Clustered BPM histogram (kernel-style grouping instead of integer bins)
 * - Low-frequency energy ratio for half/double-time disambiguation
 * - Median filtering + EMA for stable BPM output
 */

import Meyda from 'meyda'
import { getAppAssetUrl } from '../utils/appAssetUrl.js'
import {
  computeAdaptiveThreshold,
  estimateTempoFromOnsetSignal,
  estimateTempoFromPeakIntervals,
  getMedian,
  normalizeBpmToReference,
} from './tempoAnalysis.js'

const BUFFER_SIZE = 4096
const DEFAULT_SAMPLE_RATE = 44100
const BEAT_HISTORY_MAX = 90         // Increased from 60 for more stable estimates
const MIN_BPM = 60
const MAX_BPM = 200
const SILENCE_THRESHOLD = 0.005     // RMS below this = silence
const BPM_RESYNC_WINDOW_MS = 12000  // Increased from 10s for more history
const ENVELOPE_WINDOW_MS = 14000    // Increased from 12s
const TEMPO_ESTIMATE_INTERVAL_MS = 800  // More frequent envelope estimates
const BEAT_ACTIVE_WINDOW_MS = 1400
const BPM_LOCK_TOLERANCE = 5       // Tighter lock tolerance
const BPM_LOCK_HARD_TOLERANCE = 10
const MIN_ONSET_INTERVAL_MS = 220
const MAX_ONSET_INTERVAL_MS = 1200
const ENVELOPE_PEAK_MIN_INTERVAL_MS = 180

// Spectral flux onset detection thresholds
const FLUX_STDDEV_MULTIPLIER = 1.45  // Adaptive threshold on spectral-flux-like onset strength
const ENERGY_ONSET_THRESHOLD = 1.22   // Energy must exceed smoothed energy by this ratio
const LOW_BAND_ONSET_THRESHOLD = 1.5 // Low-band energy spike threshold for kick detection
const FLUX_HISTORY_SIZE = 43

// Multi-band frequency boundaries (bin indices derived from runtime sample rate)
const LOW_BAND_MAX_HZ = 300
const MID_BAND_MAX_HZ = 2000

// BPM histogram clustering
const BPM_CLUSTER_RADIUS = 2  // Group BPM candidates within ±2 BPM

// Median filter for BPM stability
const MEDIAN_HISTORY_SIZE = 7
const BPM_MEDIAN_WEIGHT = 0.3  // Blend median estimate into final output
const FEATURE_EXTRACTORS = ['rms', 'energy', 'spectralCentroid', 'zcr', 'amplitudeSpectrum']
const BPM_BUFFER_WORKLET_URL = getAppAssetUrl('worklets/bpm-buffer-processor.js')

let analyzer = null
let onsetHistory = []               // timestamps of detected onsets
let onsetEnergies = []              // { t, lowEnergy } for half/double-time analysis
let envelopeHistory = []            // { t, e } envelope samples
let lastOnsetTime = 0
let smoothedBpm = 120
let smoothedEnergy = 0
let smoothedCentroid = 0
let smoothedFlux = 0                // EMA of spectral flux
let smoothedLowBand = 0            // EMA of low-band energy
let smoothedMidBand = 0            // EMA of mid-band energy
let silenceFrames = 0
let lastTempoEstimate = 0
let lastEnvelopeBpm = 120
let bpmMedianHistory = []           // Recent BPM estimates for median filtering
let previousAmplitudeSpectrum = null // Prior spectrum for manual spectral flux calculation
let fluxHistory = []                 // recent onset-strength values for adaptive thresholding
const SILENCE_FRAMES_THRESHOLD = 30 // ~3 seconds of silence

let callback = null
let processorNode = null
let processorMessagePort = null
let previousFrame = null
let pendingSamples = []
let connectedSourceNode = null
let currentSampleRate = DEFAULT_SAMPLE_RATE
const loadedWorkletContexts = new WeakSet()

export async function startBPMDetector(audioContext, sourceNode, cb) {
  if (!audioContext || audioContext.state === 'closed') {
    throw new Error('Audio context is unavailable for BPM detector startup.')
  }

  callback = cb
  onsetHistory = []
  onsetEnergies = []
  envelopeHistory = []
  silenceFrames = 0
  lastOnsetTime = 0
  lastTempoEstimate = 0
  lastEnvelopeBpm = 120
  smoothedBpm = 120
  smoothedEnergy = 0
  smoothedCentroid = 0
  smoothedFlux = 0
  smoothedLowBand = 0
  smoothedMidBand = 0
  bpmMedianHistory = []
  previousAmplitudeSpectrum = null
  fluxHistory = []
  previousFrame = null
  pendingSamples = []
  currentSampleRate = audioContext?.sampleRate || DEFAULT_SAMPLE_RATE

  Meyda.bufferSize = BUFFER_SIZE
  Meyda.sampleRate = currentSampleRate
  Meyda.windowingFunction = 'hanning'

  if (!audioContext.audioWorklet) {
    throw new Error('AudioWorklet is unavailable in this environment.')
  }

  if (!loadedWorkletContexts.has(audioContext)) {
    await audioContext.audioWorklet.addModule(BPM_BUFFER_WORKLET_URL)
    loadedWorkletContexts.add(audioContext)
  }

  if (audioContext.state === 'closed') {
    throw new Error('Audio context closed before BPM worklet could be created.')
  }

  const processor = new AudioWorkletNode(audioContext, 'bpm-buffer-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: {
      chunkSize: BUFFER_SIZE,
    },
  })

  processor.port.onmessage = (event) => {
    const chunk = event.data instanceof Float32Array
      ? event.data
      : new Float32Array(event.data)
    processChunk(chunk)
  }

  sourceNode.connect(processor)
  connectedSourceNode = sourceNode
  processorNode = processor
  processorMessagePort = processor.port
  analyzer = {
    stop() {
      if (connectedSourceNode && processorNode) {
        connectedSourceNode.disconnect(processorNode)
        connectedSourceNode = null
      }
      if (processorMessagePort) {
        processorMessagePort.onmessage = null
        processorMessagePort.close()
        processorMessagePort = null
      }
      if (processorNode) {
        processorNode.disconnect()
        processorNode = null
      }
    },
  }
}

export function stopBPMDetector() {
  if (analyzer) {
    analyzer.stop()
    analyzer = null
  }
  onsetHistory = []
  onsetEnergies = []
  envelopeHistory = []
  silenceFrames = 0
  lastOnsetTime = 0
  lastTempoEstimate = 0
  bpmMedianHistory = []
  previousAmplitudeSpectrum = null
  fluxHistory = []
  previousFrame = null
  pendingSamples = []
  connectedSourceNode = null
  currentSampleRate = DEFAULT_SAMPLE_RATE
  callback = null
}

function processChunk(chunk) {
  if (!chunk?.length) return

  pendingSamples.push(...chunk)

  while (pendingSamples.length >= BUFFER_SIZE) {
    const frame = Float32Array.from(pendingSamples.slice(0, BUFFER_SIZE))
    pendingSamples = pendingSamples.slice(BUFFER_SIZE)

    const features = Meyda.extract(FEATURE_EXTRACTORS, frame, previousFrame)
    previousFrame = frame
    handleFrame(features, frame)
  }
}

function computeLevelDiagnostics(samples) {
  if (!samples?.length) {
    return { peakAbs: 0, clipRatio: 0 }
  }

  let peakAbs = 0
  let clippedSamples = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i] || 0)
    if (abs > peakAbs) peakAbs = abs
    if (abs >= 0.985) clippedSamples++
  }

  return {
    peakAbs,
    clipRatio: clippedSamples / samples.length,
  }
}

function computeSpectralFlux(amplitudeSpectrum) {
  if (!amplitudeSpectrum || amplitudeSpectrum.length === 0) {
    previousAmplitudeSpectrum = null
    return 0
  }

  if (!previousAmplitudeSpectrum || previousAmplitudeSpectrum.length !== amplitudeSpectrum.length) {
    previousAmplitudeSpectrum = amplitudeSpectrum.slice()
    return 0
  }

  let flux = 0
  for (let i = 0; i < amplitudeSpectrum.length; i++) {
    const delta = Math.abs(amplitudeSpectrum[i]) - Math.abs(previousAmplitudeSpectrum[i])
    if (delta > 0) flux += delta
  }

  previousAmplitudeSpectrum = amplitudeSpectrum.slice()
  return flux
}

function computeBandEnergies(amplitudeSpectrum) {
  if (!amplitudeSpectrum || amplitudeSpectrum.length === 0) {
    return { low: 0, mid: 0, high: 0 }
  }

  let low = 0
  let mid = 0
  let high = 0
  const len = amplitudeSpectrum.length
  const nyquist = Math.max(1, currentSampleRate / 2)
  const binHz = nyquist / len
  const lowBandMaxBin = Math.min(len - 1, Math.max(0, Math.round(LOW_BAND_MAX_HZ / binHz)))
  const midBandMaxBin = Math.min(len - 1, Math.max(lowBandMaxBin + 1, Math.round(MID_BAND_MAX_HZ / binHz)))

  for (let i = 0; i < len; i++) {
    const mag = amplitudeSpectrum[i] * amplitudeSpectrum[i]  // energy = magnitude^2
    if (i <= lowBandMaxBin) {
      low += mag
    } else if (i <= midBandMaxBin) {
      mid += mag
    } else {
      high += mag
    }
  }

  return {
    low: Math.sqrt(low / Math.max(1, lowBandMaxBin)),
    mid: Math.sqrt(mid / Math.max(1, midBandMaxBin - lowBandMaxBin)),
    high: Math.sqrt(high / Math.max(1, len - midBandMaxBin)),
  }
}

function handleFrame(features, frameSamples = null) {
  if (!features) return

  const { rms, spectralCentroid, zcr, amplitudeSpectrum } = features
  const now = performance.now()
  const flux = computeSpectralFlux(amplitudeSpectrum)
  const { peakAbs, clipRatio } = computeLevelDiagnostics(frameSamples)

  // Compute multi-band energies
  const bands = computeBandEnergies(amplitudeSpectrum)

  // Silence detection
  if (rms < SILENCE_THRESHOLD) {
    silenceFrames++
  } else {
    silenceFrames = 0
  }

  const isSilent = silenceFrames > SILENCE_FRAMES_THRESHOLD

  // Smooth features (exponential moving average)
  smoothedEnergy = smoothedEnergy * 0.85 + (rms || 0) * 0.15
  smoothedCentroid = smoothedCentroid * 0.9 + (spectralCentroid || 5000) * 0.1
  smoothedFlux = smoothedFlux * 0.82 + flux * 0.18
  smoothedLowBand = smoothedLowBand * 0.85 + bands.low * 0.15
  smoothedMidBand = smoothedMidBand * 0.85 + bands.mid * 0.15

  // Keep an energy envelope history for autocorrelation tempo estimation.
  envelopeHistory.push({ t: now, e: smoothedEnergy, low: bands.low })
  envelopeHistory = envelopeHistory.filter((p) => (now - p.t) <= ENVELOPE_WINDOW_MS)

  // ── Onset detection ─────────────────────────────────────────────────
  // Adaptive thresholding inspired by Beat-and-Tempo-Tracking's moving mean/std-dev onset gate.
  const onsetStrength = Math.max(0, flux) + Math.max(0, bands.low - smoothedLowBand) * 0.85
  fluxHistory.push(onsetStrength)
  if (fluxHistory.length > FLUX_HISTORY_SIZE) fluxHistory.shift()

  const fluxThreshold = computeAdaptiveThreshold(fluxHistory, FLUX_STDDEV_MULTIPLIER)
  const fluxOnset = fluxHistory.length >= 8 && onsetStrength > fluxThreshold && onsetStrength > 0.001
  const energyOnset = rms > smoothedEnergy * ENERGY_ONSET_THRESHOLD
  const lowBandOnset = bands.low > smoothedLowBand * LOW_BAND_ONSET_THRESHOLD && smoothedLowBand > 0.001
  const isOnset = !isSilent
    && (now - lastOnsetTime) > MIN_ONSET_INTERVAL_MS
    && ((fluxOnset && energyOnset) || (lowBandOnset && energyOnset))

  if (isOnset) {
    lastOnsetTime = now
    onsetHistory.push(now)
    onsetHistory = onsetHistory.filter(ts => (now - ts) <= BPM_RESYNC_WINDOW_MS)
    if (onsetHistory.length > BEAT_HISTORY_MAX) {
      onsetHistory.shift()
    }

    // Track low-band energy at onset for half/double-time analysis
    onsetEnergies.push({ t: now, lowEnergy: bands.low })
    if (onsetEnergies.length > BEAT_HISTORY_MAX) {
      onsetEnergies.shift()
    }

    const onsetBpm = estimateOnsetBPM(onsetHistory, smoothedBpm)
    if (onsetBpm) {
      const beatLockStrength = estimateBeatLockStrength(onsetHistory, smoothedBpm)
      const beatPresent = (now - lastOnsetTime) <= BEAT_ACTIVE_WINDOW_MS
      const delta = Math.abs(onsetBpm - smoothedBpm)

      let onsetWeight = 0.25
      if (beatPresent && beatLockStrength > 0.7) {
        // In locked sections, de-emphasize onset-driven nudges to avoid
        // hi-hat/transient bias pulling stable 4-on-floor tempos upward.
        onsetWeight = delta <= BPM_LOCK_TOLERANCE ? 0.06 : 0.02
      } else if (beatLockStrength > 0.45 && delta > BPM_LOCK_HARD_TOLERANCE) {
        onsetWeight = 0.06
      }

      smoothedBpm = smoothedBpm * (1 - onsetWeight) + onsetBpm * onsetWeight
    }
  }

  // ── Envelope-based tempo estimate ───────────────────────────────────
  if (!isSilent && (now - lastTempoEstimate) >= TEMPO_ESTIMATE_INTERVAL_MS) {
    lastTempoEstimate = now
    const envelopeBpm = estimateEnvelopeBPM(envelopeHistory, smoothedBpm)
    if (envelopeBpm) {
      lastEnvelopeBpm = envelopeBpm
      const beatLockStrength = estimateBeatLockStrength(onsetHistory, smoothedBpm)
      const beatPresent = (now - lastOnsetTime) <= BEAT_ACTIVE_WINDOW_MS
      const delta = Math.abs(envelopeBpm - smoothedBpm)

      let envelopeWeight = 0.25
      if (beatPresent && beatLockStrength > 0.7) {
        // Favor the envelope estimator when lock is good; it's more stable
        // for sustained 4-on-floor playback and reduces ±2-3 BPM wobble.
        envelopeWeight = delta <= BPM_LOCK_TOLERANCE ? 0.10 : 0.04
      } else if (beatLockStrength > 0.45 && delta > BPM_LOCK_HARD_TOLERANCE) {
        envelopeWeight = 0.10
      }

      smoothedBpm = smoothedBpm * (1 - envelopeWeight) + envelopeBpm * envelopeWeight
    }
  }

  smoothedBpm = normalizeBpmToReference(smoothedBpm, smoothedBpm)

  // ── Median filtering for stability ──────────────────────────────────
  const fusedBpm = smoothedBpm * 0.65 + lastEnvelopeBpm * 0.35
  const rawBpm = Math.round(fusedBpm)
  bpmMedianHistory.push(rawBpm)
  if (bpmMedianHistory.length > MEDIAN_HISTORY_SIZE) {
    bpmMedianHistory.shift()
  }
  const medianBpm = getMedian(bpmMedianHistory)
  // Blend: mostly EMA, with median stabilizer
  const finalBpm = Math.round(smoothedBpm * (1 - BPM_MEDIAN_WEIGHT) + medianBpm * BPM_MEDIAN_WEIGHT)

  const beatLockStrength = estimateBeatLockStrength(onsetHistory, smoothedBpm)
  const tempoLocked = !isSilent && beatLockStrength > 0.62 && onsetHistory.length >= 8

  callback?.({
    bpm: finalBpm,
    energy: smoothedEnergy,
    spectralCentroid: smoothedCentroid,
    rms: rms || 0,
    peakAbs,
    clipRatio,
    zcr: zcr || 0,
    lowBandEnergy: bands.low,
    isOnset,
    onsetStrength,
    onsetThreshold: fluxThreshold,
    beatLockStrength,
    tempoLocked,
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
    if (closest <= 40) coherent++  // Tightened from 45ms
  }

  return coherent / intervals.length
}

function estimateOnsetBPM(timestamps) {
  const intervalBpm = estimateTempoFromPeakIntervals(timestamps, smoothedBpm, {
    minBpm: MIN_BPM,
    maxBpm: MAX_BPM,
    clusterRadius: BPM_CLUSTER_RADIUS,
  })
  if (!intervalBpm) return null

  // Apply half/double-time disambiguation using low-frequency energy
  const disambiguated = disambiguateHalfDouble(intervalBpm)
  return normalizeBpmToReference(disambiguated, smoothedBpm, MIN_BPM, MAX_BPM)
}

/**
 * Uses low-frequency energy patterns to disambiguate half-time vs double-time.
 * If alternating onsets have significantly different low-band energy (strong/weak pattern),
 * this suggests the "strong" beats are the true downbeats and the tempo should be halved.
 */
function disambiguateHalfDouble(bpm) {
  if (onsetEnergies.length < 8) return bpm

  // Check for strong/weak alternating pattern in recent onsets
  const recent = onsetEnergies.slice(-16)
  let evenSum = 0
  let oddSum = 0
  let evenCount = 0
  let oddCount = 0

  for (let i = 0; i < recent.length; i++) {
    if (i % 2 === 0) {
      evenSum += recent[i].lowEnergy
      evenCount++
    } else {
      oddSum += recent[i].lowEnergy
      oddCount++
    }
  }

  if (evenCount === 0 || oddCount === 0) return bpm

  const evenAvg = evenSum / evenCount
  const oddAvg = oddSum / oddCount
  const ratio = Math.max(evenAvg, oddAvg) / Math.max(0.001, Math.min(evenAvg, oddAvg))

  // Strong alternating pattern (>1.8x energy difference) suggests half-time
  // but only apply if halved BPM is still in valid range
  if (ratio > 1.8) {
    const halved = bpm / 2
    if (halved >= MIN_BPM && halved <= MAX_BPM) {
      return halved
    }
  }

  // If BPM is very high and doubling pattern exists, consider if it should be halved
  if (bpm > 155 && ratio > 1.3) {
    const halved = bpm / 2
    if (halved >= MIN_BPM) {
      return halved
    }
  }

  return bpm
}

function estimateEnvelopeBPM(points, referenceBpm) {
  const onsetSignalBpm = estimateTempoFromOnsetSignal(points, referenceBpm, {
    minBpm: MIN_BPM,
    maxBpm: MAX_BPM,
  })
  if (!onsetSignalBpm) return null

  const peakBpm = pickEnvelopePeakBPM(points, (points[points.length - 1].t - points[0].t) / Math.max(1, points.length - 1), referenceBpm)
  if (!peakBpm) return normalizeBpmToReference(onsetSignalBpm, referenceBpm, MIN_BPM, MAX_BPM)

  const blended = onsetSignalBpm * 0.7 + peakBpm * 0.3
  return normalizeBpmToReference(blended, referenceBpm, MIN_BPM, MAX_BPM)
}

function pickEnvelopePeakBPM(points, frameMs, referenceBpm) {
  if (points.length < 32) return null

  const minIntervalFrames = Math.max(1, Math.round(ENVELOPE_PEAK_MIN_INTERVAL_MS / frameMs))
  const minPeakHeight = Math.max(0.01, smoothedEnergy * 0.9)
  const peaks = []

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1].e
    const curr = points[i].e
    const next = points[i + 1].e
    if (curr <= minPeakHeight || curr < prev || curr < next) continue

    const lastPeak = peaks[peaks.length - 1]
    if (!lastPeak || (i - lastPeak.index) >= minIntervalFrames) {
      peaks.push({ index: i, t: points[i].t })
    }
  }

  if (peaks.length < 4) return null

  const intervals = []
  for (let i = 1; i < peaks.length; i++) {
    const dt = peaks[i].t - peaks[i - 1].t
    if (dt >= MIN_ONSET_INTERVAL_MS && dt <= MAX_ONSET_INTERVAL_MS) {
      intervals.push(dt)
    }
  }
  if (intervals.length < 3) return null

  const sorted = intervals.slice().sort((a, b) => a - b)
  const medianInterval = sorted[Math.floor(sorted.length / 2)]
  const bpm = 60000 / medianInterval
  if (!Number.isFinite(bpm)) return null
  return normalizeBpmToReference(bpm, referenceBpm)
}

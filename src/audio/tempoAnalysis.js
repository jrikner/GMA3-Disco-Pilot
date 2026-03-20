const DEFAULT_MIN_BPM = 60
const DEFAULT_MAX_BPM = 200
const DEFAULT_CLUSTER_RADIUS = 2

export function getMedian(arr) {
  if (!arr.length) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function normalizeBpmToReference(bpm, referenceBpm, minBpm = DEFAULT_MIN_BPM, maxBpm = DEFAULT_MAX_BPM) {
  if (!Number.isFinite(bpm)) return null

  let candidate = bpm
  while (candidate < minBpm) candidate *= 2
  while (candidate > maxBpm) candidate /= 2

  if (!Number.isFinite(referenceBpm) || referenceBpm <= 0) {
    return Math.min(maxBpm, Math.max(minBpm, candidate))
  }

  const variants = [candidate / 2, candidate, candidate * 2]
    .filter((v) => v >= minBpm && v <= maxBpm)

  let best = candidate
  let bestDelta = Math.abs(candidate - referenceBpm)
  for (const variant of variants) {
    const delta = Math.abs(variant - referenceBpm)
    if (delta < bestDelta) {
      best = variant
      bestDelta = delta
    }
  }

  return best
}

export function computeAdaptiveThreshold(values, multiplier = 1.5) {
  if (!values.length) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + ((v - mean) ** 2), 0) / values.length
  const stddev = Math.sqrt(Math.max(variance, 0))
  return mean + stddev * multiplier
}

export function createTempoHistogram({
  candidates,
  minBpm = DEFAULT_MIN_BPM,
  maxBpm = DEFAULT_MAX_BPM,
  bucketSize = 0.5,
  gaussianWidth = 1.5,
}) {
  const size = Math.floor((maxBpm - minBpm) / bucketSize) + 1
  const histogram = new Float64Array(size)

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.bpm) || candidate.bpm < minBpm || candidate.bpm > maxBpm) continue
    const centerIndex = Math.round((candidate.bpm - minBpm) / bucketSize)
    const spread = Math.max(1, Math.ceil((gaussianWidth * 3) / bucketSize))

    for (let offset = -spread; offset <= spread; offset++) {
      const idx = centerIndex + offset
      if (idx < 0 || idx >= histogram.length) continue
      const bpm = minBpm + idx * bucketSize
      const distance = bpm - candidate.bpm
      const gaussianWeight = Math.exp(-(distance ** 2) / (2 * gaussianWidth ** 2))
      histogram[idx] += candidate.weight * gaussianWeight
    }
  }

  let bestIndex = -1
  let bestValue = -Infinity
  for (let i = 0; i < histogram.length; i++) {
    if (histogram[i] > bestValue) {
      bestValue = histogram[i]
      bestIndex = i
    }
  }

  return {
    histogram,
    bestBpm: bestIndex >= 0 ? minBpm + bestIndex * bucketSize : null,
    bestValue: Number.isFinite(bestValue) ? bestValue : 0,
  }
}

export function buildOnsetStrengthSignal(points) {
  if (points.length < 3) return []

  const signal = []
  for (let i = 1; i < points.length; i++) {
    const current = points[i]
    const previous = points[i - 1]
    const energyRise = Math.max(0, current.e - previous.e)
    const lowRise = Math.max(0, (current.low || 0) - (previous.low || 0))
    const strength = energyRise + lowRise * 0.85 + current.e * 0.15
    signal.push(strength)
  }

  const mean = signal.reduce((sum, v) => sum + v, 0) / signal.length
  return signal.map((v) => Math.max(0, v - mean * 0.5))
}

function generalizedAutocorrelation(signal, exponent = 0.5) {
  const transformed = signal.map((value) => Math.pow(Math.max(0, value), exponent))
  const autocorr = new Float64Array(transformed.length)

  for (let lag = 0; lag < transformed.length; lag++) {
    let score = 0
    for (let i = lag; i < transformed.length; i++) {
      score += transformed[i] * transformed[i - lag]
    }
    autocorr[lag] = score
  }

  return autocorr
}

function findLagPeaks(autocorr, minLag, maxLag, limit = 8) {
  const peaks = []
  const upper = Math.min(maxLag, autocorr.length - 2)

  for (let lag = Math.max(1, minLag); lag <= upper; lag++) {
    const current = autocorr[lag]
    if (current <= 0) continue
    if (current >= autocorr[lag - 1] && current >= autocorr[lag + 1]) {
      peaks.push({ lag, score: current })
    }
  }

  peaks.sort((a, b) => b.score - a.score)
  return peaks.slice(0, limit)
}

function scorePulseTrain(signal, lag) {
  if (lag <= 0) return 0
  let best = 0
  const maxPhase = Math.min(lag, signal.length)

  for (let phase = 0; phase < maxPhase; phase++) {
    let score = 0
    let hits = 0
    for (let idx = phase; idx < signal.length; idx += lag) {
      score += signal[idx]
      hits++
    }
    if (hits > 0) {
      best = Math.max(best, score / hits)
    }
  }

  return best
}

export function estimateTempoFromOnsetSignal(points, referenceBpm, options = {}) {
  const minBpm = options.minBpm ?? DEFAULT_MIN_BPM
  const maxBpm = options.maxBpm ?? DEFAULT_MAX_BPM
  if (points.length < 24) return null

  const frameMs = (points[points.length - 1].t - points[0].t) / Math.max(1, points.length - 1)
  if (!Number.isFinite(frameMs) || frameMs <= 0) return null

  const signal = buildOnsetStrengthSignal(points)
  if (signal.length < 16) return null

  const autocorr = generalizedAutocorrelation(signal, 0.5)
  const minLag = Math.max(1, Math.round((60000 / maxBpm) / frameMs))
  const maxLag = Math.max(minLag + 1, Math.round((60000 / minBpm) / frameMs))
  const peaks = findLagPeaks(autocorr, minLag, maxLag, 8)
  if (!peaks.length) return null

  const candidates = []
  for (const peak of peaks) {
    const baseBpm = 60000 / (peak.lag * frameMs)
    const pulseScore = scorePulseTrain(signal, peak.lag)
    const autocorrScore = peak.score / Math.max(autocorr[0] || 1, 1e-9)
    const baseWeight = autocorrScore * 0.6 + pulseScore * 0.4

    for (const multiplier of [0.5, 1, 2]) {
      const bpm = baseBpm * multiplier
      if (bpm >= minBpm && bpm <= maxBpm) {
        const harmonicPenalty = multiplier === 1 ? 1 : 0.72
        candidates.push({ bpm, weight: baseWeight * harmonicPenalty })
      }
    }
  }

  if (!candidates.length) return null
  const { bestBpm } = createTempoHistogram({ candidates, minBpm, maxBpm, bucketSize: 0.5, gaussianWidth: 1.4 })
  if (!bestBpm) return null
  return normalizeBpmToReference(bestBpm, referenceBpm, minBpm, maxBpm)
}

export function estimateTempoFromPeakIntervals(peaksMs, referenceBpm, options = {}) {
  const minBpm = options.minBpm ?? DEFAULT_MIN_BPM
  const maxBpm = options.maxBpm ?? DEFAULT_MAX_BPM
  const clusterRadius = options.clusterRadius ?? DEFAULT_CLUSTER_RADIUS
  if (peaksMs.length < 4) return null

  const candidates = []
  for (let i = 0; i < peaksMs.length; i++) {
    for (let lookahead = 1; lookahead <= 4; lookahead++) {
      const j = i + lookahead
      if (j >= peaksMs.length) break
      const interval = peaksMs[j] - peaksMs[i]
      if (interval <= 0) continue
      const subdivisions = lookahead
      const bpm = (60000 * subdivisions) / interval
      if (!Number.isFinite(bpm)) continue

      const recencyWeight = 0.7 + (i / peaksMs.length) * 0.6
      for (const multiplier of [0.5, 1, 2]) {
        const candidate = bpm * multiplier
        if (candidate >= minBpm && candidate <= maxBpm) {
          candidates.push({ bpm: candidate, weight: recencyWeight * (multiplier === 1 ? 1 : 0.65) })
        }
      }
    }
  }

  if (!candidates.length) return null

  const clusters = []
  for (const candidate of candidates) {
    let found = false
    for (const cluster of clusters) {
      if (Math.abs(candidate.bpm - cluster.center) <= clusterRadius) {
        const total = cluster.weight + candidate.weight
        cluster.center = (cluster.center * cluster.weight + candidate.bpm * candidate.weight) / total
        cluster.weight = total
        found = true
        break
      }
    }
    if (!found) clusters.push({ center: candidate.bpm, weight: candidate.weight })
  }

  clusters.sort((a, b) => b.weight - a.weight)
  const best = clusters[0]
  if (!best) return null
  return normalizeBpmToReference(best.center, referenceBpm, minBpm, maxBpm)
}

export function analyzeOfflineTempo(samples, sampleRate, options = {}) {
  const frameSize = options.frameSize ?? 1024
  const hopSize = options.hopSize ?? 512
  const minBpm = options.minBpm ?? DEFAULT_MIN_BPM
  const maxBpm = options.maxBpm ?? DEFAULT_MAX_BPM
  if (!samples?.length || sampleRate <= 0) return null

  const points = []
  const peaks = []
  const fluxHistory = []
  const fluxHistorySize = options.fluxHistorySize ?? 43
  const minPeakIntervalMs = options.minPeakIntervalMs ?? 220
  let previousEnergy = 0
  let previousLowEnergy = 0
  let lastPeakMs = -Infinity

  const lowpassAlpha = Math.exp(-(2 * Math.PI * 180) / sampleRate)
  let lowpassState = 0

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let energy = 0
    let lowEnergy = 0
    for (let i = 0; i < frameSize; i++) {
      const sample = samples[start + i]
      energy += sample * sample

      lowpassState = lowpassAlpha * lowpassState + (1 - lowpassAlpha) * sample
      lowEnergy += lowpassState * lowpassState
    }

    energy = Math.sqrt(energy / frameSize)
    lowEnergy = Math.sqrt(lowEnergy / frameSize)

    const spectralFluxLike = Math.max(0, energy - previousEnergy) + Math.max(0, lowEnergy - previousLowEnergy) * 0.9
    previousEnergy = energy
    previousLowEnergy = lowEnergy

    fluxHistory.push(spectralFluxLike)
    if (fluxHistory.length > fluxHistorySize) fluxHistory.shift()

    const t = (start / sampleRate) * 1000
    points.push({ t, e: energy, low: lowEnergy })

    const adaptiveThreshold = computeAdaptiveThreshold(fluxHistory, options.thresholdStdDev ?? 1.4)
    if (
      fluxHistory.length >= 8
      && spectralFluxLike > adaptiveThreshold
      && (t - lastPeakMs) >= minPeakIntervalMs
    ) {
      peaks.push(t)
      lastPeakMs = t
    }
  }

  const intervalTempo = estimateTempoFromPeakIntervals(peaks, 0, { minBpm, maxBpm })
  const onsetSignalTempo = estimateTempoFromOnsetSignal(points, intervalTempo || 0, { minBpm, maxBpm })

  const candidates = []
  if (intervalTempo) candidates.push({ bpm: intervalTempo, weight: 1.0 })
  if (onsetSignalTempo) candidates.push({ bpm: onsetSignalTempo, weight: 1.2 })
  if (!candidates.length) return null

  const histogram = createTempoHistogram({ candidates, minBpm, maxBpm, bucketSize: 0.5, gaussianWidth: 1.2 })
  return {
    bpm: histogram.bestBpm,
    peaks,
    points,
    intervalTempo,
    onsetSignalTempo,
  }
}

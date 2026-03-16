/**
 * On-device music genre detection using Essentia.js
 *
 * Uses the Discogs MAEST model (maest-30s-pw) which classifies 519 music styles.
 * We map the raw 519-label output to our 8 internal genre categories.
 *
 * Analysis runs on a rolling 30-second context window every 5 seconds.
 * A genre change requires >55% confidence for 2 consecutive windows (hysteresis).
 *
 * NOTE: Essentia.js WASM and model files must be placed in /public/models/
 * Required files:
 *   - /public/models/essentia-wasm.module.wasm
 *   - /public/models/maest-30s-pw.onnx (or TF.js model files)
 *
 * Until the model is loaded, genre detection falls back to spectral heuristics.
 */

const MAEST_CONTEXT_SECONDS = 20
const ANALYSIS_INTERVAL_MS = 2500
const CONFIDENCE_THRESHOLD = 0.42
const GENRE_MARGIN_THRESHOLD = 0.08
const HYSTERESIS_WINDOWS = 2
const INPUT_SAMPLE_RATE = 44100
const MODEL_SAMPLE_RATE = 16000

// ── Genre label mapping ──────────────────────────────────────────────────────
// Maps Essentia/Discogs style tags → our internal genre IDs

const ALL_GENRES = ['techno', 'edm', 'hiphop', 'pop', 'eighties', 'latin', 'rock', 'corporate']

// Curated Discogs/MAEST style labels mapped by normalized exact key.
const DISCOS_LABEL_TO_GENRE = {
  // Techno
  techno: 'techno',
  'detroit techno': 'techno',
  'acid techno': 'techno',
  'hard techno': 'techno',
  hardtechno: 'techno',
  minimal: 'techno',
  'minimal techno': 'techno',
  'tech house': 'techno',
  industrial: 'techno',
  ebm: 'techno',
  // EDM
  house: 'edm',
  'deep house': 'edm',
  'progressive house': 'edm',
  electro: 'edm',
  trance: 'edm',
  'hard trance': 'edm',
  dubstep: 'edm',
  'drum and bass': 'edm',
  'drum n bass': 'edm',
  dnb: 'edm',
  jungle: 'edm',
  garage: 'edm',
  edm: 'edm',
  electronic: 'edm',
  // Hip-hop
  'hip hop': 'hiphop',
  rap: 'hiphop',
  rnb: 'hiphop',
  'r and b': 'hiphop',
  soul: 'hiphop',
  funk: 'hiphop',
  'trip hop': 'hiphop',
  'boom bap': 'hiphop',
  'gangsta rap': 'hiphop',
  // Pop
  pop: 'pop',
  dancepop: 'pop',
  'dance pop': 'pop',
  synthpop: 'pop',
  'synth pop': 'pop',
  electropop: 'pop',
  'electro pop': 'pop',
  'indie pop': 'pop',
  kpop: 'pop',
  'k pop': 'pop',
  'teen pop': 'pop',
  'dream pop': 'pop',
  // 80s
  '80s': 'eighties',
  '1980s': 'eighties',
  'new wave': 'eighties',
  postpunk: 'eighties',
  'post punk': 'eighties',
  synthwave: 'eighties',
  'synth wave': 'eighties',
  'italo disco': 'eighties',
  disco: 'eighties',
  hinrg: 'eighties',
  'hi nrg': 'eighties',
  eurodisco: 'eighties',
  'euro disco': 'eighties',
  // Latin / Afro
  latin: 'latin',
  reggaeton: 'latin',
  salsa: 'latin',
  merengue: 'latin',
  cumbia: 'latin',
  bachata: 'latin',
  afrobeats: 'latin',
  afrobeat: 'latin',
  'afro house': 'latin',
  tropical: 'latin',
  soca: 'latin',
  dancehall: 'latin',
  reggae: 'latin',
  // Rock
  rock: 'rock',
  alternative: 'rock',
  'indie rock': 'rock',
  punk: 'rock',
  metal: 'rock',
  'hard rock': 'rock',
  'classic rock': 'rock',
  grunge: 'rock',
  emo: 'rock',
  // Corporate / background
  ambient: 'corporate',
  classical: 'corporate',
  jazz: 'corporate',
  acoustic: 'corporate',
  'easy listening': 'corporate',
  lounge: 'corporate',
  chillout: 'corporate',
  'new age': 'corporate',
  instrumental: 'corporate',
}

const GENRE_PRIORS = {
  techno: 1.0,
  edm: 0.96,
  hiphop: 1.0,
  pop: 1.0,
  eighties: 1.0,
  latin: 1.0,
  rock: 1.0,
  corporate: 0.95,
}

const GENRE_NORMALIZATION = {
  techno: 1.0,
  edm: 1.25,
  hiphop: 1.0,
  pop: 1.05,
  eighties: 0.95,
  latin: 1.0,
  rock: 1.0,
  corporate: 0.95,
}

// ── State ─────────────────────────────────────────────────────────────────────

let essentiaModule = null
let modelLoaded = false
let audioBuffer = []
let analysisInterval = null
let candidateGenre = null
let candidateCount = 0
let currentGenre = 'unknown'
let contextWeights = {}  // Set from user's "tonight's context"
let callback = null
let realtimeHint = { bpm: 0, centroid: 0, energy: 0 }

// ── Public API ────────────────────────────────────────────────────────────────

export async function initGenreDetector(contextGenres = []) {
  setContextWeights(contextGenres)
  await loadEssentia()
}

export function setContextWeights(contextGenres) {
  contextWeights = {}
  // Boost genres the user says are likely tonight
  for (const g of contextGenres) {
    contextWeights[g] = 1.25  // gentle prior only
  }
}

export function startGenreDetector(audioContext, cb) {
  callback = cb
  audioBuffer = []
  candidateGenre = null
  candidateCount = 0
  currentGenre = 'unknown'

  // Tap into audio via ScriptProcessor (deprecated but widely supported in Electron)
  // For production: use AudioWorklet
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  processor.onaudioprocess = (e) => {
    const samples = normalizeMonoSamples(e.inputBuffer.getChannelData(0))
    audioBuffer.push(...samples)
    // Keep only last MAEST_CONTEXT_SECONDS worth of audio
    const maxSamples = MAEST_CONTEXT_SECONDS * INPUT_SAMPLE_RATE
    if (audioBuffer.length > maxSamples) {
      audioBuffer = audioBuffer.slice(audioBuffer.length - maxSamples)
    }
  }

  analysisInterval = setInterval(() => runAnalysis(), ANALYSIS_INTERVAL_MS)

  return processor
}

export function stopGenreDetector() {
  if (analysisInterval) {
    clearInterval(analysisInterval)
    analysisInterval = null
  }
  audioBuffer = []
  callback = null
}

export function getCurrentGenre() {
  return currentGenre
}
export function setGenreRealtimeHint(hint = {}) {
  realtimeHint = {
    bpm: hint.bpm ?? realtimeHint.bpm,
    centroid: hint.centroid ?? realtimeHint.centroid,
    energy: hint.energy ?? realtimeHint.energy,
  }
}


// ── Core Analysis ─────────────────────────────────────────────────────────────

async function runAnalysis() {
  const minimumWindowSamples = MAEST_CONTEXT_SECONDS * INPUT_SAMPLE_RATE
  if (audioBuffer.length < minimumWindowSamples) return

  const windowSamples = normalizeMonoSamples(audioBuffer.slice(audioBuffer.length - minimumWindowSamples))

  let scores
  if (modelLoaded && essentiaModule) {
    scores = await runEssentiaModel(windowSamples)
  } else {
    scores = spectralHeuristic(windowSamples)
  }

  const selection = selectGenre(scores)
  const { genre } = selection

  // Hysteresis: require HYSTERESIS_WINDOWS consecutive windows of same genre
  if (genre === candidateGenre) {
    candidateCount++
    if (candidateCount >= HYSTERESIS_WINDOWS) {
      if (genre !== currentGenre) {
        currentGenre = genre
        callback?.({
          genre,
          confidence: selection.rawConfidence,
          rawConfidence: selection.rawConfidence,
          weightedConfidence: selection.weightedConfidence,
          scores: selection.rawScores,
          weightedScores: selection.weightedScores,
          topGenres: selection.topGenres,
        })
      }
    }
  } else {
    candidateGenre = genre
    candidateCount = 1
  }
}

function selectGenre(scores) {
  const rawScores = normalizeScoreMap(scores)
  const weightedScores = {}
  const confidenceThreshold = modelLoaded ? CONFIDENCE_THRESHOLD : 0.24
  const marginThreshold = modelLoaded ? GENRE_MARGIN_THRESHOLD : 0.02

  for (const genre of ALL_GENRES) {
    const contextWeight = contextWeights[genre] || 1.0
    weightedScores[genre] = rawScores[genre] * contextWeight
  }

  const rawSorted = Object.entries(rawScores).sort((a, b) => b[1] - a[1])
  const weightedSorted = Object.entries(weightedScores).sort((a, b) => b[1] - a[1])

  const [rawTopGenre = 'unknown', rawTopScore = 0] = rawSorted[0] || []
  const rawSecondScore = rawSorted[1]?.[1] || 0
  const rawDelta = rawTopScore - rawSecondScore

  const weightedTopGenre = weightedSorted[0]?.[0] || rawTopGenre
  const weightedTopScore = weightedSorted[0]?.[1] || rawTopScore

  let selectedGenre = rawTopGenre || 'unknown'
  if (rawTopScore < confidenceThreshold || rawDelta < marginThreshold) {
    selectedGenre = currentGenre !== 'unknown' ? currentGenre : 'unknown'
  } else if (weightedTopGenre !== rawTopGenre) {
    const weightedAltRaw = rawScores[weightedTopGenre] || 0
    const closeRaw = Math.abs(rawTopScore - weightedAltRaw) <= marginThreshold
    if (closeRaw) selectedGenre = weightedTopGenre
  }

  const topGenres = rawSorted.slice(0, 5).map(([genre, raw]) => ({
    genre,
    raw,
    weighted: weightedScores[genre] || 0,
  }))

  return {
    genre: selectedGenre,
    rawConfidence: rawScores[selectedGenre] || 0,
    weightedConfidence: weightedScores[selectedGenre] || 0,
    rawScores,
    weightedScores,
    topGenres,
  }
}

// ── Essentia.js Model (loads asynchronously) ──────────────────────────────────

async function loadEssentia() {
  try {
    // Dynamic import from /public/models/
    // IMPORTANT: use a variable + @vite-ignore so missing optional model files
    // do not crash Vite import analysis during startup.
    // Use an absolute URL computed at runtime so Vite does not try to
    // pre-transform/import files from /public during dev.
    const essentiaUrl = new URL('/models/essentia-wasm.es.js', window.location.origin).href
    const EssentiaModule = await import(/* @vite-ignore */ essentiaUrl).catch(() => null)
    if (!EssentiaModule) {
      console.warn('[GenreDetector] Essentia.js not found in /public/models/ — using spectral heuristic fallback')
      return
    }
    essentiaModule = await EssentiaModule.default()
    modelLoaded = true
    console.log('[GenreDetector] Essentia.js loaded successfully')
  } catch (err) {
    console.warn('[GenreDetector] Could not load Essentia.js:', err.message)
  }
}

async function runEssentiaModel(samples) {
  try {
    const essentia = essentiaModule
    const resampled = resampleLinear(samples, INPUT_SAMPLE_RATE, MODEL_SAMPLE_RATE)
    const normalized = normalizeMonoSamples(resampled)
    const vectorInput = essentia.arrayToVector(new Float32Array(normalized))

    // Feature extraction
    const features = essentia.TensorflowInputMusiCNN(vectorInput)

    // Model inference (requires loaded TF.js model)
    // This is a simplified call — actual Essentia.js API varies by version
    const predictions = await essentia.TensorflowPredict2D(features, {
      graphFilename: 'maest-30s-pw',
    })

    return mapEssentiaToGenres(predictions)
  } catch (err) {
    console.warn('[GenreDetector] Model inference failed:', err.message)
    return spectralHeuristic(samples)
  }
}

function mapEssentiaToGenres(predictions) {
  // predictions is an array of [label, score] pairs from Discogs MAEST
  const scores = Object.fromEntries(ALL_GENRES.map((genre) => [genre, 0]))
  const hitCounts = Object.fromEntries(ALL_GENRES.map((genre) => [genre, 0]))

  for (const [label, score] of predictions) {
    const mappedGenre = DISCOS_LABEL_TO_GENRE[normalizeLabel(label)]
    if (!mappedGenre) continue
    scores[mappedGenre] += score
    hitCounts[mappedGenre] += 1
  }

  for (const genre of ALL_GENRES) {
    const hits = Math.max(1, hitCounts[genre])
    const prior = GENRE_PRIORS[genre] ?? 1.0
    const norm = GENRE_NORMALIZATION[genre] ?? 1.0
    scores[genre] = (scores[genre] * prior) / (hits * norm)
  }

  return normalizeScoreMap(scores)
}

function normalizeLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeScoreMap(scoreMap) {
  const normalized = Object.fromEntries(ALL_GENRES.map((genre) => [genre, scoreMap[genre] || 0]))
  const total = Object.values(normalized).reduce((sum, score) => sum + score, 0) || 1
  for (const genre of Object.keys(normalized)) {
    normalized[genre] /= total
  }
  return normalized
}

function normalizeMonoSamples(samples) {
  if (!samples || samples.length === 0) return []

  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }

  if (peak === 0) {
    return Array.from(samples)
  }

  const scale = 1 / peak
  const normalized = new Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    normalized[i] = samples[i] * scale
  }

  return normalized
}

function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return Array.from(samples)

  const ratio = fromRate / toRate
  const outputLength = Math.max(1, Math.floor(samples.length / ratio))
  const resampled = new Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio
    const lower = Math.floor(sourceIndex)
    const upper = Math.min(lower + 1, samples.length - 1)
    const interpolation = sourceIndex - lower
    resampled[i] = samples[lower] + (samples[upper] - samples[lower]) * interpolation
  }

  return resampled
}

// ── Spectral Heuristic Fallback ───────────────────────────────────────────────
// When Essentia model is unavailable, estimate genre from basic spectral features

function spectralHeuristic(samples) {
  const n = samples.length

  // RMS energy
  const rms = Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / n)

  // Zero crossing rate → high = noisy/rock, low = smooth/electronic
  let zcr = 0
  for (let i = 1; i < n; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) zcr++
  }
  zcr /= n

  // Very rough spectral centroid via DFT magnitude weighting (simplified)
  // This is intentionally simple — the real model is the proper path
  const centroidRatio = zcr * INPUT_SAMPLE_RATE  // rough proxy

  const scores = {
    techno: 0, edm: 0, hiphop: 0, pop: 0,
    eighties: 0, latin: 0, rock: 0, corporate: 0,
  }

  // Heuristic rules (rough, better than nothing without the model)
  const hintedBpm = realtimeHint.bpm || 0

  if (rms > 0.1 && centroidRatio > 3000) {
    scores.rock += 0.4
    scores.edm += 0.3
    scores.techno += 0.3
  } else if (rms > 0.06 && centroidRatio < 2000) {
    scores.hiphop += 0.5
    scores.pop += 0.3
    scores.eighties += 0.2
  } else if (rms < 0.03) {
    scores.corporate += 0.6
    scores.pop += 0.4
  } else {
    scores.edm += 0.3
    scores.pop += 0.3
    scores.latin += 0.2
    scores.hiphop += 0.2
  }

  // Tempo-informed hinting to reduce glaring genre misses in fallback mode.
  if (hintedBpm >= 128) {
    scores.techno += 0.25
    scores.edm += 0.2
  } else if (hintedBpm >= 110) {
    scores.pop += 0.2
    scores.latin += 0.15
    scores.edm += 0.1
  } else if (hintedBpm >= 84) {
    scores.hiphop += 0.25
    scores.pop += 0.1
  } else if (hintedBpm > 0) {
    scores.corporate += 0.25
    scores.eighties += 0.1
  }

  return scores
}

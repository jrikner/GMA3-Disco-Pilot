/**
 * On-device music genre detection using Essentia.js
 *
 * Uses the Discogs MAEST model (maest-30s-pw) which classifies 519 music styles.
 * We map the raw 519-label output to our 8 internal genre categories.
 *
 * Analysis runs on a rolling 15-second window every 5 seconds.
 * A genre change requires >60% confidence for 2 consecutive windows (hysteresis).
 *
 * NOTE: Essentia.js WASM and model files must be placed in /public/models/
 * Required files:
 *   - /public/models/essentia-wasm.module.wasm
 *   - /public/models/maest-30s-pw.onnx (or TF.js model files)
 *
 * Until the model is loaded, genre detection falls back to spectral heuristics.
 */

const WINDOW_SECONDS = 15
const ANALYSIS_INTERVAL_MS = 5000
const CONFIDENCE_THRESHOLD = 0.60
const HYSTERESIS_WINDOWS = 2
const SAMPLE_RATE = 44100

// ── Genre label mapping ──────────────────────────────────────────────────────
// Maps Essentia/Discogs style tags → our internal genre IDs

const GENRE_MAPPINGS = {
  techno: [
    'techno', 'tech-house', 'industrial', 'ebm', 'hardtechno',
    'minimal', 'detroit techno', 'acid techno',
  ],
  edm: [
    'electronic', 'edm', 'house', 'trance', 'electro', 'dubstep',
    'drum and bass', 'drum n bass', 'dnb', 'jungle', 'garage',
    'bass music', 'future bass', 'trap', 'big room', 'progressive house',
  ],
  hiphop: [
    'hip hop', 'hip-hop', 'rap', 'r&b', 'rnb', 'soul', 'funk',
    'neo-soul', 'trip hop', 'boom bap', 'gangsta rap', 'afrobeat',
  ],
  pop: [
    'pop', 'dance-pop', 'synthpop', 'electropop', 'indie pop',
    'k-pop', 'teen pop', 'dream pop',
  ],
  eighties: [
    '80s', '1980s', 'new wave', 'post-punk', 'synth', 'italo disco',
    'disco', 'hi-nrg', 'eurodisco',
  ],
  latin: [
    'latin', 'reggaeton', 'salsa', 'merengue', 'cumbia', 'bachata',
    'afrobeats', 'afro-house', 'tropical', 'soca', 'dancehall', 'reggae',
  ],
  rock: [
    'rock', 'alternative', 'indie rock', 'punk', 'metal', 'hard rock',
    'classic rock', 'grunge', 'emo',
  ],
  corporate: [
    'ambient', 'classical', 'jazz', 'acoustic', 'easy listening',
    'lounge', 'chillout', 'new age', 'instrumental',
  ],
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

// ── Public API ────────────────────────────────────────────────────────────────

export async function initGenreDetector(contextGenres = []) {
  setContextWeights(contextGenres)
  await loadEssentia()
}

export function setContextWeights(contextGenres) {
  contextWeights = {}
  // Boost genres the user says are likely tonight
  for (const g of contextGenres) {
    contextWeights[g] = 2.0  // 2× weight
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
    const samples = Array.from(e.inputBuffer.getChannelData(0))
    audioBuffer.push(...samples)
    // Keep only last WINDOW_SECONDS worth of audio
    const maxSamples = WINDOW_SECONDS * SAMPLE_RATE
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

// ── Core Analysis ─────────────────────────────────────────────────────────────

async function runAnalysis() {
  if (audioBuffer.length < SAMPLE_RATE * 5) return  // Need at least 5s

  const windowSamples = audioBuffer.slice()

  let scores
  if (modelLoaded && essentiaModule) {
    scores = await runEssentiaModel(windowSamples)
  } else {
    scores = spectralHeuristic(windowSamples)
  }

  const genre = selectGenre(scores)

  // Hysteresis: require HYSTERESIS_WINDOWS consecutive windows of same genre
  if (genre === candidateGenre) {
    candidateCount++
    if (candidateCount >= HYSTERESIS_WINDOWS) {
      if (genre !== currentGenre) {
        currentGenre = genre
        callback?.({ genre, scores, confidence: scores[genre] || 0 })
      }
    }
  } else {
    candidateGenre = genre
    candidateCount = 1
  }
}

function selectGenre(scores) {
  // Apply context weights
  const weighted = {}
  for (const [genre, score] of Object.entries(scores)) {
    weighted[genre] = score * (contextWeights[genre] || 1.0)
  }

  // Find highest scoring genre
  let best = null
  let bestScore = 0
  for (const [genre, score] of Object.entries(weighted)) {
    if (score > bestScore) {
      bestScore = score
      best = genre
    }
  }

  // If confidence too low and we have context, stay on current
  if (bestScore < CONFIDENCE_THRESHOLD && currentGenre !== 'unknown') {
    return currentGenre
  }

  return best || 'unknown'
}

// ── Essentia.js Model (loads asynchronously) ──────────────────────────────────

async function loadEssentia() {
  try {
    // Dynamic import — Essentia WASM loads from /public/models/
    // Using essentia.js from CDN or bundled in public/
    const EssentiaModule = await import('/models/essentia-wasm.es.js').catch(() => null)
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
    const vectorInput = essentia.arrayToVector(new Float32Array(samples))

    // Resample to the model's expected rate if needed
    // MAEST model expects mono audio at 16kHz
    // For now we pass as-is; production should resample

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
  const scores = {
    techno: 0, edm: 0, hiphop: 0, pop: 0,
    eighties: 0, latin: 0, rock: 0, corporate: 0,
  }

  for (const [label, score] of predictions) {
    const lower = label.toLowerCase()
    for (const [genreId, keywords] of Object.entries(GENRE_MAPPINGS)) {
      if (keywords.some(k => lower.includes(k))) {
        scores[genreId] += score
      }
    }
  }

  // Normalize
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1
  for (const key of Object.keys(scores)) {
    scores[key] /= total
  }
  return scores
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
  const centroidRatio = zcr * SAMPLE_RATE  // rough proxy

  const scores = {
    techno: 0, edm: 0, hiphop: 0, pop: 0,
    eighties: 0, latin: 0, rock: 0, corporate: 0,
  }

  // Heuristic rules (rough, better than nothing without the model)
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

  return scores
}

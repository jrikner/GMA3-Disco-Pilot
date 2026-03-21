import * as tf from '@tensorflow/tfjs'
import { APP_GENRES, buildGenreScoreMap, mapDiscogsLabelToGenre, parseDiscogsLabel } from './genreTaxonomy.js'

const ANALYSIS_INTERVAL_MS = 5000
const MODEL_SAMPLE_RATE = 16000
const MODEL_WINDOW_SECONDS = 30
const MODEL_WINDOW_SAMPLES = MODEL_SAMPLE_RATE * MODEL_WINDOW_SECONDS
const MODEL_FRAME_SIZE = 512
const MODEL_HOP_SIZE = 256
const MAEST_PATCH_FRAMES = 1876
const MAEST_BANDS = 96
const ANALYSIS_CHUNK_SIZE = 4096
const HYSTERESIS_WINDOWS = 2
const SCORE_SMOOTHING_ALPHA = 0.35
const CONTEXT_BOOST = 1.2
const CURRENT_GENRE_STICKINESS = 0.08
const CANDIDATE_GENRE_STICKINESS = 0.05
const MIN_CONFIDENCE = 0.18
const MIN_MARGIN = 0.035
const DEFAULT_LABELS_URL = '/models/discogs_519labels.txt'
const DEFAULT_METADATA_URL = '/models/maest-30s-pw/metadata.json'
const DEFAULT_GRAPH_URL = '/models/maest-30s-pw/model.json'
const GENRE_BUFFER_WORKLET_URL = '/worklets/genre-buffer-processor.js'

let callback = null
let detectorStatus = {
  mode: 'maest',
  reason: 'initializing',
  detail: 'Genre detector is initializing.',
}

let runtime = null
let graphModel = null
let modelLabels = []
let modelInputName = 'melspectrogram'
let modelOutputName = null
let currentSampleRate = 44100
let audioBuffer = []
let analysisInterval = null
let isAnalysisRunning = false
let currentGenre = 'unknown'
let candidateGenre = null
let candidateCount = 0
let smoothedScores = Object.fromEntries(APP_GENRES.map((genre) => [genre, 1 / APP_GENRES.length]))
let contextWeights = {}
let processorNode = null
let processorMessagePort = null
let loadPromise = null
const loadedWorkletContexts = new WeakSet()


function normalizeTensorName(name) {
  const value = String(name || '').trim()
  return value.replace(/:\d+$/, '')
}

function listUniqueTensorNames(values = []) {
  return [...new Set(values.map((value) => normalizeTensorName(value)).filter(Boolean))]
}

function getModelInputCandidates(model) {
  return listUniqueTensorNames([
    model?.inputs?.[0]?.name,
    ...(Array.isArray(model?.inputNodes) ? model.inputNodes : []),
    ...(Array.isArray(model?.executor?.graph?.inputs) ? model.executor.graph.inputs.map((entry) => entry?.name) : []),
    'melspectrogram',
  ])
}

function getModelOutputCandidates(model) {
  return listUniqueTensorNames([
    ...(Array.isArray(model?.outputs) ? model.outputs.map((entry) => entry?.name) : []),
    ...(Array.isArray(model?.outputNodes) ? model.outputNodes : []),
    ...(Array.isArray(model?.executor?.graph?.outputs) ? model.executor.graph.outputs.map((entry) => entry?.name) : []),
    'PartitionedCall/Identity_13',
  ])
}

function looksLikeLabelOutput(tensorShape, expectedLabelCount) {
  if (!Array.isArray(tensorShape) || !expectedLabelCount) return false
  const numericShape = tensorShape.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
  if (!numericShape.length) return false
  const lastDimension = numericShape[numericShape.length - 1]
  return lastDimension === expectedLabelCount
}

async function resolveModelIo(model, expectedLabelCount) {
  const inputCandidates = getModelInputCandidates(model)
  const outputCandidates = getModelOutputCandidates(model)

  const preferredInput = inputCandidates[0] || 'melspectrogram'

  const shapedOutput = outputCandidates.find((candidate) => {
    const matchingOutput = Array.isArray(model?.outputs)
      ? model.outputs.find((entry) => normalizeTensorName(entry?.name) === candidate)
      : null
    return looksLikeLabelOutput(matchingOutput?.shape, expectedLabelCount)
  })

  if (shapedOutput) {
    return {
      inputName: preferredInput,
      outputName: shapedOutput,
    }
  }

  if (outputCandidates.length <= 1 && inputCandidates.length <= 1) {
    return {
      inputName: preferredInput,
      outputName: outputCandidates[0] || null,
    }
  }

  const probeTensor = tf.zeros([1, MAEST_PATCH_FRAMES, MAEST_BANDS], 'float32')

  try {
    for (const inputName of inputCandidates.length ? inputCandidates : [preferredInput]) {
      for (const outputName of outputCandidates) {
        try {
          const rawOutput = typeof model.executeAsync === 'function'
            ? await model.executeAsync({ [inputName]: probeTensor }, outputName)
            : model.execute({ [inputName]: probeTensor }, outputName)

          const tensor = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput
          const values = await tensor?.data?.()
          const valueCount = values?.length || 0
          const matchesLabelCount = valueCount === expectedLabelCount || looksLikeLabelOutput(tensor?.shape, expectedLabelCount)
          tf.dispose(rawOutput)

          if (matchesLabelCount) {
            return {
              inputName,
              outputName,
            }
          }
        } catch {
          // Ignore incompatible endpoints while probing model I/O.
        }
      }
    }
  } finally {
    probeTensor.dispose()
  }

  return {
    inputName: preferredInput,
    outputName: outputCandidates[0] || null,
  }
}

function normalizeScoreMap(scoreMap) {
  const normalized = Object.fromEntries(APP_GENRES.map((genre) => [genre, Number(scoreMap[genre] || 0)]))
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0)

  if (total <= 0) {
    return Object.fromEntries(APP_GENRES.map((genre) => [genre, 1 / APP_GENRES.length]))
  }

  for (const genre of APP_GENRES) {
    normalized[genre] /= total
  }

  return normalized
}

function smoothScores(nextScores) {
  const smoothed = {}
  for (const genre of APP_GENRES) {
    const previous = smoothedScores[genre] || 0
    const incoming = nextScores[genre] || 0
    smoothed[genre] = (previous * (1 - SCORE_SMOOTHING_ALPHA)) + (incoming * SCORE_SMOOTHING_ALPHA)
  }
  smoothedScores = normalizeScoreMap(smoothed)
  return smoothedScores
}

function applySelectionWeights(scores) {
  const weighted = { ...scores }

  for (const genre of APP_GENRES) {
    weighted[genre] *= contextWeights[genre] || 1
  }

  if (currentGenre !== 'unknown') {
    weighted[currentGenre] *= (1 + CURRENT_GENRE_STICKINESS)
  }

  if (candidateGenre && candidateGenre !== 'unknown') {
    weighted[candidateGenre] *= (1 + CANDIDATE_GENRE_STICKINESS)
  }

  return normalizeScoreMap(weighted)
}

function selectGenre(scoreMap) {
  const rawScores = smoothScores(normalizeScoreMap(scoreMap))
  const weightedScores = applySelectionWeights(rawScores)
  const rawSorted = Object.entries(rawScores).sort((a, b) => b[1] - a[1])
  const weightedSorted = Object.entries(weightedScores).sort((a, b) => b[1] - a[1])
  const [topGenre = 'unknown', topScore = 0] = rawSorted[0] || []
  const secondScore = rawSorted[1]?.[1] || 0
  const rawMargin = topScore - secondScore
  const weightedWinner = weightedSorted[0]?.[0] || topGenre

  let selectedGenre = topGenre
  if (topScore < MIN_CONFIDENCE || rawMargin < MIN_MARGIN) {
    selectedGenre = currentGenre !== 'unknown' ? currentGenre : topGenre
  } else if (weightedWinner !== topGenre) {
    const weightedWinnerRaw = rawScores[weightedWinner] || 0
    if ((topScore - weightedWinnerRaw) <= MIN_MARGIN) {
      selectedGenre = weightedWinner
    }
  }

  return {
    genre: selectedGenre,
    rawScores,
    weightedScores,
    topGenres: rawSorted.slice(0, 5).map(([genre, raw]) => ({
      genre,
      raw,
      weighted: weightedScores[genre] || 0,
    })),
    rawConfidence: rawScores[selectedGenre] || 0,
    weightedConfidence: weightedScores[selectedGenre] || 0,
  }
}

function resetStreamingState() {
  audioBuffer = []
  isAnalysisRunning = false
  currentGenre = 'unknown'
  candidateGenre = null
  candidateCount = 0
  smoothedScores = Object.fromEntries(APP_GENRES.map((genre) => [genre, 1 / APP_GENRES.length]))
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) return null
  return response.json().catch(() => null)
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) return null
  return response.text().catch(() => null)
}

function formatErrorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function parseLabelsFromText(text) {
  if (!text) return []
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function loadLabelsAndMetadata() {
  const [metadata, labelText] = await Promise.all([
    fetchJson(DEFAULT_METADATA_URL),
    fetchText(DEFAULT_LABELS_URL),
  ])

  const metadataClasses = Array.isArray(metadata?.classes) ? metadata.classes.map((value) => String(value).trim()).filter(Boolean) : []
  const labelClasses = parseLabelsFromText(labelText)
  const labels = metadataClasses.length ? metadataClasses : labelClasses

  return {
    metadata,
    labels,
  }
}

async function resolveRuntime() {
  const [wasmModuleImport, coreModuleImport] = await Promise.all([
    import(/* @vite-ignore */ new URL('/models/essentia-wasm.es.js', window.location.origin).href),
    import(/* @vite-ignore */ new URL('/models/essentia.js-core.es.js', window.location.origin).href),
  ])

  const wasmModule = wasmModuleImport?.EssentiaWASM || wasmModuleImport?.default?.EssentiaWASM || wasmModuleImport?.default
  const Core = coreModuleImport?.default || coreModuleImport?.Essentia
  if (!wasmModule || !Core) {
    throw new Error('Essentia runtime files are present but do not expose the expected ES module API.')
  }

  const essentia = new Core(wasmModule)
  return {
    wasmModule,
    essentia,
    delete() {
      if (typeof essentia?.delete === 'function') essentia.delete()
      if (typeof essentia?.shutdown === 'function') essentia.shutdown()
    },
  }
}

async function loadModelAssets() {
  const manifest = await fetchJson(DEFAULT_GRAPH_URL)
  if (!manifest) {
    throw new Error('No TensorFlow.js MAEST graph model was found at /public/models/maest-30s-pw/model.json.')
  }

  if (!manifest.modelTopology || !Array.isArray(manifest.weightsManifest)) {
    throw new Error('The MAEST graph manifest is not a valid TensorFlow.js graph model.')
  }

  const { metadata, labels } = await loadLabelsAndMetadata()
  if (!labels.length) {
    throw new Error('No Discogs labels were found. Add discogs_519labels.txt or maest-30s-pw/metadata.json to public/models/.')
  }

  const model = await tf.loadGraphModel(DEFAULT_GRAPH_URL, { onProgress: undefined })
  const modelIo = await resolveModelIo(model, labels.length)

  return {
    manifest,
    metadata,
    labels,
    model,
    modelIo,
  }
}

async function loadDetector() {
  if (graphModel && runtime) return
  if (loadPromise) {
    await loadPromise
    return
  }

  loadPromise = (async () => {
    detectorStatus = {
      mode: 'maest',
      reason: 'loading',
      detail: 'Loading Essentia preprocessing and the Discogs-MAEST graph.',
    }

    try {
      runtime = await resolveRuntime()
      const assets = await loadModelAssets()
      graphModel = assets.model
      modelLabels = assets.labels
      modelInputName = assets.modelIo?.inputName || 'melspectrogram'
      modelOutputName = assets.modelIo?.outputName || null

      detectorStatus = {
        mode: 'maest',
        reason: 'ready',
        detail: `Loaded Essentia preprocessing and Discogs-MAEST (${modelLabels.length} labels; input: ${modelInputName}; output: ${modelOutputName || 'default'}).`,
      }
    } catch (error) {
      detectorStatus = {
        mode: 'unavailable',
        reason: 'load_error',
        detail: formatErrorMessage(error),
      }
      throw error
    }
  })()

  await loadPromise
}

function safeDelete(value) {
  if (!value || typeof value.delete !== 'function') return
  try {
    value.delete()
  } catch {
    // Ignore third-party cleanup failures.
  }
}

function trimAudioBuffer() {
  const maxSamples = Math.ceil(currentSampleRate * MODEL_WINDOW_SECONDS)
  if (audioBuffer.length > maxSamples) {
    audioBuffer = audioBuffer.slice(audioBuffer.length - maxSamples)
  }
}

function normalizeMonoSamples(samples) {
  if (!samples?.length) return new Float32Array(0)

  let peak = 0
  for (let i = 0; i < samples.length; i += 1) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }

  if (!Number.isFinite(peak) || peak <= 0) {
    return Float32Array.from(samples)
  }

  const scale = peak > 1 ? 1 / peak : 1
  const output = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    output[i] = samples[i] * scale
  }

  return output
}

async function resampleAudio(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) return Float32Array.from(samples)

  const frameCount = Math.max(1, Math.round((samples.length / sourceRate) * targetRate))
  const offlineContext = new OfflineAudioContext(1, frameCount, targetRate)
  const buffer = offlineContext.createBuffer(1, samples.length, sourceRate)
  buffer.copyToChannel(Float32Array.from(samples), 0)

  const source = offlineContext.createBufferSource()
  source.buffer = buffer
  source.connect(offlineContext.destination)
  source.start()

  const rendered = await offlineContext.startRendering()
  return rendered.getChannelData(0).slice(0)
}

function repeatLastFrame(frames, expectedLength) {
  if (!frames.length) {
    return Array.from({ length: expectedLength }, () => new Float32Array(MAEST_BANDS))
  }

  const padded = frames.slice()
  while (padded.length < expectedLength) {
    padded.push(Float32Array.from(padded[padded.length - 1]))
  }

  return padded
}

function extractMaestPatch(samples) {
  const essentia = runtime?.essentia
  if (!essentia) {
    throw new Error('Essentia runtime is not loaded.')
  }

  const frames = []
  for (let start = 0; start + MODEL_FRAME_SIZE <= samples.length; start += MODEL_HOP_SIZE) {
    const frame = samples.subarray(start, start + MODEL_FRAME_SIZE)
    let vectorInput = null
    let bands = null

    try {
      vectorInput = essentia.arrayToVector(frame)
      const result = essentia.TensorflowInputMusiCNN(vectorInput)
      bands = result?.bands || result
      frames.push(Float32Array.from(essentia.vectorToArray(bands)))
    } finally {
      safeDelete(bands)
      safeDelete(vectorInput)
    }
  }

  const preparedFrames = repeatLastFrame(frames, MAEST_PATCH_FRAMES).slice(-MAEST_PATCH_FRAMES)
  return preparedFrames.flatMap((frame) => Array.from(frame))
}

async function predictMaest(samples) {
  const resampled = await resampleAudio(samples, currentSampleRate, MODEL_SAMPLE_RATE)
  const normalized = normalizeMonoSamples(resampled.slice(-MODEL_WINDOW_SAMPLES))
  const flattenedPatch = extractMaestPatch(normalized)

  const input = tf.tensor(flattenedPatch, [1, MAEST_PATCH_FRAMES, MAEST_BANDS], 'float32')
  const inputName = modelInputName || 'melspectrogram'
  const modelInputs = { [inputName]: input }

  try {
    const rawOutput = modelOutputName
      ? (typeof graphModel.executeAsync === 'function'
          ? await graphModel.executeAsync(modelInputs, modelOutputName)
          : graphModel.execute(modelInputs, modelOutputName))
      : (typeof graphModel.executeAsync === 'function'
          ? await graphModel.executeAsync(modelInputs)
          : graphModel.execute(modelInputs))

    const tensor = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput
    const values = await tensor.data()
    const output = Array.from(values)
    tf.dispose(rawOutput)

    if (modelLabels.length && output.length !== modelLabels.length) {
      throw new Error(`MAEST output size mismatch: expected ${modelLabels.length}, received ${output.length}${modelOutputName ? ` from ${modelOutputName}` : ''}.`)
    }

    return output
  } finally {
    input.dispose()
  }
}

function aggregateDiscogsScores(logits) {
  const genreScores = buildGenreScoreMap()
  const genreHits = buildGenreScoreMap()

  const labeledScores = logits
    .map((score, index) => ({
      label: modelLabels[index] || `label_${index}`,
      score: Number(score) || 0,
      parsed: parseDiscogsLabel(modelLabels[index] || `label_${index}`),
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
    .sort((a, b) => b.score - a.score)

  labeledScores.forEach((entry, index) => {
    const mappedGenre = mapDiscogsLabelToGenre(entry.parsed)
    const rankWeight = 1 - ((index / Math.max(1, labeledScores.length)) * 0.35)
    genreScores[mappedGenre] += entry.score * rankWeight
    genreHits[mappedGenre] += 1
  })

  for (const genre of APP_GENRES) {
    const hits = Math.max(1, genreHits[genre])
    genreScores[genre] /= hits
  }

  return normalizeScoreMap(genreScores)
}

async function runAnalysis() {
  if (isAnalysisRunning || detectorStatus.reason !== 'ready') return

  const minimumSamples = Math.ceil(currentSampleRate * MODEL_WINDOW_SECONDS)
  if (audioBuffer.length < minimumSamples) return

  isAnalysisRunning = true

  try {
    const windowSamples = Float32Array.from(audioBuffer.slice(audioBuffer.length - minimumSamples))
    const logits = await predictMaest(windowSamples)
    const aggregatedScores = aggregateDiscogsScores(logits)
    const selection = selectGenre(aggregatedScores)

    if (selection.genre === candidateGenre) {
      candidateCount += 1
    } else {
      candidateGenre = selection.genre
      candidateCount = 1
    }

    if (candidateCount >= HYSTERESIS_WINDOWS && selection.genre !== currentGenre) {
      currentGenre = selection.genre
      callback?.({
        genre: selection.genre,
        confidence: selection.weightedConfidence,
        rawConfidence: selection.rawConfidence,
        weightedConfidence: selection.weightedConfidence,
        scores: selection.rawScores,
        weightedScores: selection.weightedScores,
        topGenres: selection.topGenres,
      })
    }
  } catch (error) {
    detectorStatus = {
      mode: 'unavailable',
      reason: 'inference_failed',
      detail: formatErrorMessage(error),
    }
    console.warn('[GenreDetector] MAEST inference failed:', error)
  } finally {
    isAnalysisRunning = false
  }
}

export async function initGenreDetector(contextGenres = []) {
  setContextWeights(contextGenres)
  try {
    await loadDetector()
  } catch (error) {
    console.warn('[GenreDetector] Initialization warning:', error)
  }
  return getGenreDetectorStatus()
}

export function setContextWeights(contextGenres) {
  contextWeights = {}
  for (const genre of contextGenres || []) {
    if (APP_GENRES.includes(genre)) {
      contextWeights[genre] = CONTEXT_BOOST
    }
  }
}

export async function startGenreDetector(audioContext, cb) {
  callback = cb
  currentSampleRate = audioContext?.sampleRate || currentSampleRate
  resetStreamingState()

  if (detectorStatus.reason !== 'ready') {
    try {
      await loadDetector()
    } catch (error) {
      console.warn('[GenreDetector] Start skipped:', error)
    }
  }

  if (detectorStatus.reason !== 'ready') {
    return null
  }

  if (!audioContext?.audioWorklet) {
    throw new Error('AudioWorklet is unavailable in this environment.')
  }

  if (!loadedWorkletContexts.has(audioContext)) {
    await audioContext.audioWorklet.addModule(GENRE_BUFFER_WORKLET_URL)
    loadedWorkletContexts.add(audioContext)
  }

  const processor = new AudioWorkletNode(audioContext, 'genre-buffer-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: {
      chunkSize: ANALYSIS_CHUNK_SIZE,
    },
  })

  processor.port.onmessage = (event) => {
    const chunk = normalizeMonoSamples(new Float32Array(event.data))
    audioBuffer.push(...chunk)
    trimAudioBuffer()
  }

  processorNode = processor
  processorMessagePort = processor.port
  analysisInterval = window.setInterval(() => {
    void runAnalysis()
  }, ANALYSIS_INTERVAL_MS)

  return processor
}

export function stopGenreDetector() {
  if (analysisInterval) {
    window.clearInterval(analysisInterval)
    analysisInterval = null
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

  callback = null
  resetStreamingState()
}

export function getGenreDetectorStatus() {
  return { ...detectorStatus }
}

export function getCurrentGenre() {
  return currentGenre
}

export function setGenreRealtimeHint() {
  // Intentionally a no-op. The remodeled detector is driven directly by Essentia MAEST output.
}

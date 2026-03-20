import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const modelsDir = path.join(repoRoot, 'public', 'models')
const maestDir = path.join(modelsDir, 'maest-30s-pw')
const essentiaDistDir = path.join(repoRoot, 'node_modules', 'essentia.js', 'dist')
const labelsUrl = 'https://huggingface.co/mtg-upf/discogs-maest-30s-pw-129e-519l/resolve/main/discogs_519labels.txt'
const args = new Set(process.argv.slice(2))
const mode = args.has('check') ? 'check' : 'setup'
const shouldDownloadLabels = !args.has('--skip-labels')

async function exists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true })
}

async function copyFileVerbose(source, dest) {
  await fs.copyFile(source, dest)
  console.log(`✔ Copied ${path.relative(repoRoot, source)} -> ${path.relative(repoRoot, dest)}`)
}

async function findEssentiaWasmSource() {
  const distEntries = await fs.readdir(essentiaDistDir)
  const wasmFile = distEntries.find((entry) => /^essentia-wasm.*\.wasm$/.test(entry))
  return wasmFile ? path.join(essentiaDistDir, wasmFile) : null
}

async function downloadTextFile(url, dest) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  await fs.writeFile(dest, text)
  console.log(`✔ Downloaded ${url} -> ${path.relative(repoRoot, dest)}`)
}

async function listWeightShards() {
  if (!(await exists(maestDir))) return []
  const entries = await fs.readdir(maestDir)
  return entries.filter((entry) => /^group.*\.bin$/.test(entry)).sort()
}

async function summarizeStatus() {
  const runtimeJs = path.join(modelsDir, 'essentia-wasm.es.js')
  const runtimeWasm = path.join(modelsDir, 'essentia-wasm.module.wasm')
  const labelsFile = path.join(modelsDir, 'discogs_519labels.txt')
  const modelJson = path.join(maestDir, 'model.json')
  const shardFiles = await listWeightShards()

  const runtimeReady = (await exists(runtimeJs)) && (await exists(runtimeWasm))
  const labelsReady = await exists(labelsFile)
  const modelReady = (await exists(modelJson)) && shardFiles.length > 0

  console.log('\nModel asset status:')
  console.log(`- Essentia runtime: ${runtimeReady ? 'ready' : 'missing files'}`)
  console.log(`- Discogs labels: ${labelsReady ? 'ready' : 'missing'}`)
  console.log(`- MAEST TF.js graph: ${modelReady ? `ready (${shardFiles.length} shard file${shardFiles.length === 1 ? '' : 's'})` : 'missing model.json and/or group*.bin shards'}`)

  if (!runtimeReady) {
    console.log('\nThe app will not be able to load Essentia.js until the runtime files are copied into public/models/.')
  } else if (!modelReady) {
    console.log('\nThe app can run now, but it will stay in spectral heuristic mode until you add a TensorFlow.js MAEST export at public/models/maest-30s-pw/model.json with every group*.bin shard referenced by that manifest.')
  } else if (!labelsReady) {
    console.log('\nThe MAEST graph is present, but discogs_519labels.txt is still needed to map 519-class output back to the app\'s internal genres.')
  } else {
    console.log('\nAll optional high-accuracy model assets are present. Restart the app after any changes to public/models/.')
  }

  return { runtimeReady, labelsReady, modelReady }
}

async function runSetup() {
  await ensureDir(modelsDir)
  await ensureDir(maestDir)

  if (!(await exists(essentiaDistDir))) {
    throw new Error('node_modules/essentia.js/dist is missing. Run `npm install --no-save essentia.js` (or `npm run setup:models`) first.')
  }

  await copyFileVerbose(
    path.join(essentiaDistDir, 'essentia-wasm.es.js'),
    path.join(modelsDir, 'essentia-wasm.es.js'),
  )

  const wasmSource = await findEssentiaWasmSource()
  if (!wasmSource) {
    throw new Error('Could not find an essentia-wasm*.wasm file in node_modules/essentia.js/dist.')
  }

  await copyFileVerbose(wasmSource, path.join(modelsDir, 'essentia-wasm.module.wasm'))

  if (shouldDownloadLabels) {
    try {
      await downloadTextFile(labelsUrl, path.join(modelsDir, 'discogs_519labels.txt'))
    } catch (error) {
      console.warn(`⚠ Could not download discogs_519labels.txt automatically: ${error.message}`)
      console.warn('  You can still add it manually later if your network blocks Hugging Face.')
    }
  }

  console.log('\nNote: this repo does not ship the MAEST TensorFlow.js graph export, so setup cannot create public/models/maest-30s-pw/model.json for you.')
  console.log('If you only have maest-30s-pw.onnx, the app will continue using the fallback detector because the browser code expects a TensorFlow.js graph model manifest plus weight shards. If you have the official frozen .pb + metadata .json pair, run `npm run convert:maest -- /path/to/model.pb /path/to/model.json` to generate public/models/maest-30s-pw/model.json and its shards.')
}

async function main() {
  if (mode === 'setup') {
    await runSetup()
  }

  const status = await summarizeStatus()
  if (mode === 'check' && !status.runtimeReady) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`✖ ${error.message}`)
  process.exit(1)
})

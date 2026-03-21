import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const modelsDir = path.join(repoRoot, 'public', 'models')
const maestDir = path.join(modelsDir, 'maest-30s-pw')
const essentiaDistDir = path.join(repoRoot, 'node_modules', 'essentia.js', 'dist')
const labelsUrl = 'https://huggingface.co/mtg-upf/discogs-maest-30s-pw-129e-519l/resolve/main/discogs_519labels.txt'
const metadataUrl = 'https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.json'
const args = new Set(process.argv.slice(2))
const mode = args.has('check') ? 'check' : 'setup'
const shouldDownloadLabels = !args.has('--skip-labels')
const shouldDownloadMetadata = !args.has('--skip-metadata')

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
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    await fs.writeFile(dest, text)
    console.log(`✔ Downloaded ${url} -> ${path.relative(repoRoot, dest)}`)
    return
  } catch (error) {
    try {
      await execFileAsync('curl', ['-L', '--fail', '--silent', '--show-error', url, '-o', dest], { cwd: repoRoot })
      console.log(`✔ Downloaded ${url} -> ${path.relative(repoRoot, dest)} (via curl)`)
      return
    } catch (curlError) {
      throw new Error(`${error.message}; curl fallback failed: ${curlError.message}`)
    }
  }
}

async function writeLabelsFromMetadata(dest, metadataPath) {
  const raw = await fs.readFile(metadataPath, 'utf8')
  const parsed = JSON.parse(raw)
  const classes = Array.isArray(parsed?.classes) ? parsed.classes.map((value) => String(value).trim()).filter(Boolean) : []
  if (!classes.length) {
    throw new Error('metadata.json does not contain a non-empty classes array')
  }
  await fs.writeFile(dest, `${classes.join('\n')}\n`)
  console.log(`✔ Derived ${path.relative(repoRoot, dest)} from ${path.relative(repoRoot, metadataPath)}`)
}

async function listWeightShards() {
  if (!(await exists(maestDir))) return []
  const entries = await fs.readdir(maestDir)
  return entries.filter((entry) => /^group.*\.bin$/.test(entry)).sort()
}

async function summarizeStatus() {
  const runtimeWasm = path.join(modelsDir, 'essentia-wasm.module.wasm')
  const runtimeLoader = path.join(modelsDir, 'essentia-wasm.es.js')
  const runtimeCore = path.join(modelsDir, 'essentia.js-core.es.js')
  const labelsFile = path.join(modelsDir, 'discogs_519labels.txt')
  const metadataFile = path.join(maestDir, 'metadata.json')
  const modelJson = path.join(maestDir, 'model.json')
  const shardFiles = await listWeightShards()

  const runtimeReady = (await exists(runtimeLoader)) && (await exists(runtimeWasm)) && (await exists(runtimeCore))
  const labelsReady = await exists(labelsFile)
  const metadataReady = await exists(metadataFile)
  const modelReady = (await exists(modelJson)) && shardFiles.length > 0

  console.log('\nModel asset status:')
  console.log(`- Essentia runtime: ${runtimeReady ? 'ready' : 'missing files'}`)
  console.log(`- Discogs labels: ${labelsReady ? 'ready' : 'missing'}`)
  console.log(`- MAEST metadata: ${metadataReady ? 'ready' : 'missing'}`)
  console.log(`- MAEST TF.js graph: ${modelReady ? `ready (${shardFiles.length} shard file${shardFiles.length === 1 ? '' : 's'})` : 'missing model.json and/or group*.bin shards'}`)

  if (!runtimeReady) {
    console.log('\nThe app cannot run Essentia preprocessing until essentia-wasm.es.js, essentia-wasm.module.wasm, and essentia.js-core.es.js are copied into public/models/.')
  } else if (!modelReady) {
    console.log('\nThe app can capture audio, but genre detection remains unavailable until you add a TensorFlow.js MAEST export at public/models/maest-30s-pw/model.json with every referenced group*.bin shard.')
  } else if (!labelsReady) {
    console.log('\nThe MAEST graph is present, but discogs_519labels.txt is still needed so the 519 outputs can be mapped back to Discogs styles.')
  } else {
    console.log('\nEssentia preprocessing assets, labels, and the MAEST graph are ready. Restart the app after changing files in public/models/.')
  }

  return { runtimeReady, labelsReady, metadataReady, modelReady }
}

async function runSetup() {
  await ensureDir(modelsDir)
  await ensureDir(maestDir)

  if (!(await exists(essentiaDistDir))) {
    throw new Error('node_modules/essentia.js/dist is missing. Run `npm install` first.')
  }

  await copyFileVerbose(
    path.join(essentiaDistDir, 'essentia-wasm.es.js'),
    path.join(modelsDir, 'essentia-wasm.es.js'),
  )

  await copyFileVerbose(
    path.join(essentiaDistDir, 'essentia.js-core.es.js'),
    path.join(modelsDir, 'essentia.js-core.es.js'),
  )

  const wasmSource = await findEssentiaWasmSource()
  if (!wasmSource) {
    throw new Error('Could not find an essentia-wasm*.wasm file in node_modules/essentia.js/dist.')
  }

  await copyFileVerbose(wasmSource, path.join(modelsDir, 'essentia-wasm.module.wasm'))

  const labelsPath = path.join(modelsDir, 'discogs_519labels.txt')
  const metadataPath = path.join(maestDir, 'metadata.json')

  if (shouldDownloadLabels) {
    try {
      await downloadTextFile(labelsUrl, labelsPath)
    } catch (error) {
      console.warn(`⚠ Could not download discogs_519labels.txt automatically: ${error.message}`)
    }
  }

  if (shouldDownloadMetadata) {
    try {
      await downloadTextFile(metadataUrl, metadataPath)
    } catch (error) {
      console.warn(`⚠ Could not download MAEST metadata automatically: ${error.message}`)
    }
  }

  if (!(await exists(labelsPath)) && (await exists(metadataPath))) {
    await writeLabelsFromMetadata(labelsPath, metadataPath)
  }

  console.log('\nNote: setup copies the Essentia browser runtime and downloads the official Discogs-MAEST metadata/labels, but you still need a TensorFlow.js graph export for browser inference.')
  console.log('If you have the official frozen .pb + metadata .json pair, run `npm run convert:maest -- /path/to/model.pb /path/to/model.json` to create public/models/maest-30s-pw/model.json and its shards.')
}

async function main() {
  if (mode === 'setup') {
    await runSetup()
  }

  const status = await summarizeStatus()
  if (mode === 'check' && (!status.runtimeReady || !status.modelReady || !status.labelsReady)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`✖ ${error.message}`)
  process.exit(1)
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const modelsDir = path.join(repoRoot, 'public', 'models')
const outputDir = path.join(modelsDir, 'maest-30s-pw')

function usage() {
  console.error('Usage: npm run convert:maest -- <path-to-model.pb> <path-to-metadata.json>')
  console.error('Example: npm run convert:maest -- ~/Downloads/discogs-maest-30s-pw-519l-2.pb ~/Downloads/discogs-maest-30s-pw-519l-2.json')
}

function normalizePath(input) {
  if (!input) return null
  if (path.isAbsolute(input)) return input
  return path.resolve(process.cwd(), input)
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readMetadata(metadataPath) {
  const raw = await fs.readFile(metadataPath, 'utf8')
  const parsed = JSON.parse(raw)
  const classes = Array.isArray(parsed?.classes)
    ? parsed.classes.map((value) => String(value).trim()).filter(Boolean)
    : []

  if (!classes.length) {
    throw new Error(`Metadata file ${metadataPath} does not include a non-empty classes array.`)
  }

  return {
    parsed,
    classes,
    labelCount: classes.length,
    labelsFile: classes.length === 400 ? 'discogs_400labels.txt' : 'discogs_519labels.txt',
  }
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', args, {
      cwd: repoRoot,
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`python ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function main() {
  const [pbArg, metadataArg] = process.argv.slice(2)
  if (!pbArg || !metadataArg) {
    usage()
    process.exit(1)
  }

  const pbPath = normalizePath(pbArg)
  const metadataPath = normalizePath(metadataArg)

  if (!(await exists(pbPath))) throw new Error(`Frozen graph not found: ${pbPath}`)
  if (!(await exists(metadataPath))) throw new Error(`Metadata JSON not found: ${metadataPath}`)

  const metadata = await readMetadata(metadataPath)
  await fs.mkdir(modelsDir, { recursive: true })
  await fs.mkdir(outputDir, { recursive: true })

  const labelsPath = path.join(modelsDir, metadata.labelsFile)
  await fs.writeFile(labelsPath, `${metadata.classes.join('\n')}\n`)

  const tfjsMetadata = JSON.stringify({
    sourceGraph: path.basename(pbPath),
    sourceMetadata: path.basename(metadataPath),
    labelCount: metadata.labelCount,
    labelsFile: metadata.labelsFile,
    sourceModelName: metadata.parsed?.name || null,
  })

  console.log(`Converting ${path.basename(pbPath)} -> public/models/maest-30s-pw/model.json`)
  await runPython([
    '-m',
    'tensorflowjs.converters.converter',
    '--input_format=tf_frozen_model',
    '--output_format=tfjs_graph_model',
    '--output_node_names=PartitionedCall/Identity_13',
    `--metadata=${tfjsMetadata}`,
    pbPath,
    outputDir,
  ])

  console.log(`Wrote labels to public/models/${metadata.labelsFile}`)
  console.log('Done. The converted TensorFlow.js graph is ready for the browser loader.')
}

main().catch((error) => {
  console.error(`✖ ${error.message}`)
  console.error('\nIf tensorflowjs is not installed, run:')
  console.error('  python -m pip install tensorflow==2.17.1 tf-keras==2.17.0 tensorflowjs==4.22.0')
  process.exit(1)
})

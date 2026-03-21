import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const repoRoot = process.cwd()
const venvDir = path.join(repoRoot, '.venv-maest')
const isWindows = process.platform === 'win32'
const MIN_SUPPORTED_MINOR = 9
const MAX_SUPPORTED_MINOR = 12
const pythonMlDependencies = [
  'setuptools>=70',
  'tensorflow==2.19.0',
  'tf-keras==2.19.0',
  'tensorflowjs==4.22.0',
  'tensorflow-decision-forests==1.12.0',
]

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      ...options,
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function readPythonVersion(python) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      python,
      ['-c', 'import json, sys; print(json.dumps({"major": sys.version_info.major, "minor": sys.version_info.minor, "micro": sys.version_info.micro}))'],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${python} exited with code ${code}`))
        return
      }

      try {
        resolve(JSON.parse(stdout.trim()))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function isSupportedTfPython(version) {
  return version?.major === 3 && version?.minor >= MIN_SUPPORTED_MINOR && version?.minor <= MAX_SUPPORTED_MINOR
}

function formatPythonVersion(version) {
  return `${version.major}.${version.minor}.${version.micro}`
}

function isSamePythonRelease(left, right) {
  return left?.major === right?.major && left?.minor === right?.minor
}

function getVenvPythonPath() {
  return isWindows
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function findPython() {
  const candidates = [
    process.env.PYTHON,
    'python3.12',
    'python3.11',
    'python3.10',
    'python3.9',
    'python3',
    'python',
  ].filter(Boolean)

  const unsupported = []

  for (const candidate of candidates) {
    try {
      await run(candidate, ['--version'], { stdio: 'ignore' })
      const version = await readPythonVersion(candidate)

      if (isSupportedTfPython(version)) {
        return { python: candidate, version }
      }

      unsupported.push({ candidate, version })
    } catch {
      // Try the next candidate.
    }
  }

  if (unsupported.length) {
    const seen = unsupported.map(({ candidate, version }) => `${candidate} (${formatPythonVersion(version)})`).join(', ')
    throw new Error(
      `Found Python interpreter(s), but none use a TensorFlow.js conversion-compatible version. ` +
      `Detected: ${seen}. Use Python 3.9-3.12 instead (for example Homebrew python@3.12), then rerun npm run setup:python-ml.`,
    )
  }

  throw new Error('Could not find python3 or python on PATH. Install Python 3 first.')
}

async function main() {
  const { python, version } = await findPython()
  const venvPython = getVenvPythonPath()

  if (await pathExists(venvPython)) {
    let shouldRecreate = false
    let recreateReason = `to recreate it with ${python} (${formatPythonVersion(version)})`

    try {
      const existingVersion = await readPythonVersion(venvPython)
      shouldRecreate = !isSupportedTfPython(existingVersion) || !isSamePythonRelease(existingVersion, version)

      if (shouldRecreate) {
        recreateReason =
          `because it was built with Python ${formatPythonVersion(existingVersion)} ` +
          `and needs to be recreated with ${python} (${formatPythonVersion(version)})`
      }
    } catch {
      shouldRecreate = true
      recreateReason = `because it could not be inspected and needs to be recreated with ${python} (${formatPythonVersion(version)})`
    }

    if (shouldRecreate) {
      console.log(`Removing existing .venv-maest ${recreateReason}.`)
      await fs.rm(venvDir, { recursive: true, force: true })
    }
  }

  await fs.mkdir(venvDir, { recursive: true })

  if (!(await pathExists(venvPython))) {
    await run(python, ['-m', 'venv', venvDir])
  }

  await run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'])
  await run(venvPython, ['-m', 'pip', 'install', ...pythonMlDependencies])

  console.log('\n✔ Python MAEST conversion environment is ready.')
  console.log(`Created with ${python} (${formatPythonVersion(version)}).`)
  console.log(`Use ${venvPython} -m tensorflowjs.converters.converter ... or run npm run convert:maest -- /path/to/model.pb /path/to/model.json`)
}

main().catch((error) => {
  console.error(`✖ ${error.message}`)
  process.exit(1)
})

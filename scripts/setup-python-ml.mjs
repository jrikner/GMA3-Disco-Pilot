import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const repoRoot = process.cwd()
const venvDir = path.join(repoRoot, '.venv-maest')
const isWindows = process.platform === 'win32'

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

async function findPython() {
  const candidates = [
    process.env.PYTHON,
    'python3',
    'python',
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      await run(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Could not find python3 or python on PATH. Install Python 3 first.')
}

async function main() {
  const python = await findPython()

  await fs.mkdir(venvDir, { recursive: true })
  await run(python, ['-m', 'venv', venvDir])

  const venvPython = isWindows
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')

  await run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  await run(venvPython, ['-m', 'pip', 'install', 'tensorflow==2.17.1', 'tf-keras==2.17.0', 'tensorflowjs==4.22.0'])

  console.log('\n✔ Python MAEST conversion environment is ready.')
  console.log(`Use ${venvPython} -m tensorflowjs.converters.converter ... or run npm run convert:maest -- /path/to/model.pb /path/to/model.json`)
}

main().catch((error) => {
  console.error(`✖ ${error.message}`)
  process.exit(1)
})

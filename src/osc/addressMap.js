/**
 * Dynamic OSC address registry.
 *
 * After the LUA plugin runs in MA3 and creates sequences in the user's free
 * executor spaces, the app stores the exact page/executor for each function here.
 *
 * The address map is derived from the wizard's ExecutorMap configuration.
 */

/**
 * Default empty map — populated after setup wizard completes.
 *
 * Structure:
 * {
 *   colorLooks: {
 *     sequence: { page: 2, exec: 1 },
 *     cueMap: {
 *       techno: 1,
 *       edm: 2,
 *       hiphop: 3,
 *       pop: 4,
 *       eighties: 5,
 *       latin: 6,
 *       rock: 7,
 *       corporate: 8,
 *     }
 *   },
 *   phasers: {
 *     ptSlow:    { page: 2, exec: 10 },
 *     panOnly:   { page: 2, exec: 11 },
 *     tiltOnly:  { page: 2, exec: 12 },
 *     colorChase:{ page: 2, exec: 13 },
 *     dimPulse:  { page: 2, exec: 14 },
 *   },
 *   masters: {
 *     bpmRate:   { page: 2, exec: 15 },
 *     effectSize:{ page: 2, exec: 16 },
 *   }
 * }
 */

let map = {
  colorLooks: {},
  phasers: {},
  masters: {},
}

/** Calibrated boundaries per executor, if the operator chooses to store them. */
let boundaries = {}  // key: `${page}_${exec}` → { min: 0, max: 1 }

const GENRES = ['techno', 'edm', 'hiphop', 'pop', 'eighties', 'latin', 'rock', 'corporate']

const DEFAULT_PHASER_CONFIG = {
  includePanOnly: true,
  includeTiltOnly: true,
}

export function getExecutorPlan({ fixtureGroups = [], phaserConfig = {} } = {}) {
  const mergedPhaserConfig = { ...DEFAULT_PHASER_CONFIG, ...phaserConfig }
  const hasMoverGroups = fixtureGroups.some(g => g.attributes?.pt)
  const hasRgbGroups = fixtureGroups.some(g => g.attributes?.rgb || g.attributes?.colorWheel)
  const hasAnyGroups = fixtureGroups.length > 0

  const rows = [
    { key: 'color_sequence', label: 'Color Looks Sequence (cues 1–8)', type: 'color' },
  ]

  if (hasMoverGroups) {
    rows.push({ key: 'phaser_ptSlow', label: 'Phaser: Pan/Tilt Circle', type: 'phaser' })
    if (mergedPhaserConfig.includePanOnly) {
      rows.push({ key: 'phaser_panOnly', label: 'Phaser: Pan-only', type: 'phaser' })
    }
    if (mergedPhaserConfig.includeTiltOnly) {
      rows.push({ key: 'phaser_tiltOnly', label: 'Phaser: Tilt-only', type: 'phaser' })
    }
  }

  if (hasRgbGroups) {
    rows.push({ key: 'phaser_colorChase', label: 'Phaser: Color Chase', type: 'phaser' })
  }

  if (hasAnyGroups) {
    rows.push({ key: 'phaser_dimPulse', label: 'Phaser: Dimmer Pulse', type: 'phaser' })
  }

  rows.push(
    { key: 'master_bpmRate', label: 'Master: BPM Rate', type: 'master' },
    { key: 'master_effectSize', label: 'Master: Effect Size', type: 'master' },
  )

  return rows
}

export function setAddressMap(newMap) {
  map = newMap
}

export function getAddressMap() {
  return map
}

export function setBoundary(page, exec, min, max) {
  boundaries[`${page}_${exec}`] = { min, max }
}

export function getBoundary(page, exec) {
  return boundaries[`${page}_${exec}`] || { min: 0, max: 1 }
}

export function getColorLookExecutor(genre) {
  const sequence = map.colorLooks?.sequence
  if (!sequence) return null
  const cue = map.colorLooks?.cueMap?.[genre]
  return cue ? { ...sequence, cue } : null
}

export function getColorLookSequence() {
  return map.colorLooks?.sequence || null
}

export function getPhaserExecutor(type) {
  return map.phasers[type] || null
}

export function getMasterExecutor(type) {
  return map.masters[type] || null
}

/**
 * Build the address map from the wizard's free executor allocation.
 * Called by the wizard after the LUA plugin is generated.
 *
 * @param {Object} wizardConfig - from ExecutorMap step
 *   { page: number, startExec: number }
 */
export function buildAddressMapFromWizard(wizardConfig) {
  const {
    page,
    startExec,
    fixtureGroups = [],
    phaserConfig = {},
  } = wizardConfig
  let exec = startExec

  const cueMap = {}
  GENRES.forEach((genre, index) => {
    cueMap[genre] = index + 1
  })

  const colorLooks = {
    sequence: { page, exec: exec++ },
    cueMap,
  }

  const phasers = {}
  const masters = {}

  for (const row of getExecutorPlan({ fixtureGroups, phaserConfig }).slice(1)) {
    const target = row.type === 'master' ? masters : phasers
    const key = row.key.replace(/^(phaser|master)_/, '')
    target[key] = { page, exec: exec++ }
  }

  map = { colorLooks, phasers, masters }
  return map
}

export function getAllExecutors() {
  const all = []
  if (map.colorLooks?.sequence) {
    all.push({
      key: 'color_sequence',
      label: 'Color Looks Sequence',
      ...map.colorLooks.sequence,
    })
  }
  for (const [type, loc] of Object.entries(map.phasers)) {
    all.push({ key: `phaser_${type}`, label: `Phaser: ${type}`, ...loc })
  }
  for (const [type, loc] of Object.entries(map.masters)) {
    all.push({ key: `master_${type}`, label: `Master: ${type}`, ...loc })
  }
  return all
}

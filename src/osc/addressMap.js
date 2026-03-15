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
 *     ptFast:    { page: 2, exec: 11 },
 *     colorChase:{ page: 2, exec: 12 },
 *     dimPulse:  { page: 2, exec: 13 },
 *   },
 *   masters: {
 *     bpmRate:   { page: 2, exec: 20 },
 *     effectSize:{ page: 2, exec: 21 },
 *   }
 * }
 */

let map = {
  colorLooks: {},
  phasers: {},
  masters: {},
}

/** Calibrated boundaries per executor (set during Setup Wizard step 7) */
let boundaries = {}  // key: `${page}_${exec}` → { min: 0, max: 1 }

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
  const { page, startExec } = wizardConfig
  let exec = startExec

  const genres = ['techno', 'edm', 'hiphop', 'pop', 'eighties', 'latin', 'rock', 'corporate']
  const cueMap = {}
  genres.forEach((genre, index) => {
    cueMap[genre] = index + 1
  })
  const colorLooks = {
    sequence: { page, exec: exec++ },
    cueMap,
  }

  const phasers = {
    ptSlow:     { page, exec: exec++ },
    ptFast:     { page, exec: exec++ },
    colorChase: { page, exec: exec++ },
    dimPulse:   { page, exec: exec++ },
  }

  const masters = {
    bpmRate:    { page, exec: exec++ },
    effectSize: { page, exec: exec++ },
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

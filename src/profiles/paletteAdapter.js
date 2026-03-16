import { GENRE_PROFILES } from './genreProfiles.js'

const DEFAULT_NEUTRAL = { h: 200, s: 30, l: 60, label: 'Neutral' }

/**
 * Build an ordered cue-friendly palette for a genre.
 *
 * @param {string} genreId
 * @param {Object} [options]
 * @param {Array<{h:number,s:number,l:number,label?:string}>} [options.avoidColors]
 * @param {Array<{h:number,s:number,l:number,label?:string}>} [options.emphasizeColors]
 * @param {number} [options.maxColors]
 * @returns {Array<{h:number,s:number,l:number,label?:string}>}
 */
export function buildCueFriendlyPalette(genreId, options = {}) {
  const {
    avoidColors: rawAvoidColors = [],
    emphasizeColors: rawEmphasizeColors = [],
    maxColors = 6,
  } = options

  const cappedMax = Number.isFinite(maxColors) ? Math.max(1, Math.floor(maxColors)) : 6
  const avoidColors = normalizeColors(rawAvoidColors)
  const emphasizeColors = normalizeColors(rawEmphasizeColors)
  const basePalette = getBaseGenrePalette(genreId)

  const viableBase = basePalette.filter(color => !isAvoided(color, avoidColors))
  const viableEmphasis = emphasizeColors.filter(color => !isAvoided(color, avoidColors))

  // Emphasized colors take priority and should survive de-duplication.
  const candidates = dedupeByHue([...viableEmphasis, ...viableBase])

  if (candidates.length === 0) {
    return [DEFAULT_NEUTRAL]
  }

  const selected = []

  // Always select emphasized colors first (ordered by harmony + contrast between emphasized picks).
  for (const emphasized of viableEmphasis) {
    if (selected.length >= cappedMax) break
    const match = candidates.find(candidate => candidate === emphasized)
    if (!match || selected.includes(match)) continue

    selected.push(match)
  }

  while (selected.length < Math.min(cappedMax, candidates.length)) {
    const remaining = candidates.filter(color => !selected.includes(color))
    const next = pickBestNext(remaining, selected, viableBase, viableEmphasis)
    if (!next) break
    selected.push(next)
  }

  return selected
}

export function getBaseGenrePalette(genreId) {
  const profile = GENRE_PROFILES[genreId] || GENRE_PROFILES.unknown
  const colors = profile?.colorPalette?.colors || []
  return normalizeColors(colors)
}

function pickBestNext(candidates, selected, basePalette, emphasizeColors) {
  if (candidates.length === 0) return null

  let best = candidates[0]
  let bestScore = Number.NEGATIVE_INFINITY

  for (const candidate of candidates) {
    const score =
      scoreHarmonyToBase(candidate, basePalette) * 0.45 +
      scoreContrast(candidate, selected) * 0.35 +
      scoreEmphasis(candidate, emphasizeColors) * 0.2

    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return best
}

function normalizeColors(colors) {
  return asArray(colors)
    .map((color, idx) => ({
      h: normalizeHue(color?.h),
      s: clamp(color?.s ?? 70, 0, 100),
      l: clamp(color?.l ?? 50, 0, 100),
      label: color?.label || `Color ${idx + 1}`,
    }))
    .filter(color => Number.isFinite(color.h))
}

function dedupeByHue(colors, threshold = 12) {
  const deduped = []
  for (const color of colors) {
    if (!deduped.some(existing => hueDist(existing.h, color.h) < threshold)) {
      deduped.push(color)
    }
  }
  return deduped
}

function isAvoided(color, avoidColors, threshold = 30) {
  return avoidColors.some(avoid => hueDist(color.h, avoid.h) < threshold)
}

function scoreHarmonyToBase(candidate, basePalette) {
  if (basePalette.length === 0) return 0

  return Math.max(
    ...basePalette.map(base => {
      const distance = hueDist(candidate.h, base.h)
      return harmonyScoreFromDistance(distance)
    })
  )
}

function scoreContrast(candidate, selected) {
  if (selected.length === 0) return 0.5

  const minHueDistance = Math.min(...selected.map(color => hueDist(candidate.h, color.h)))
  const hueContrast = clamp(minHueDistance / 180, 0, 1)

  const minLightnessDistance = Math.min(...selected.map(color => Math.abs(candidate.l - color.l)))
  const lightnessContrast = clamp(minLightnessDistance / 100, 0, 1)

  return hueContrast * 0.75 + lightnessContrast * 0.25
}

function scoreEmphasis(candidate, emphasizeColors) {
  if (emphasizeColors.length === 0) return 0

  const closest = Math.min(...emphasizeColors.map(color => hueDist(candidate.h, color.h)))
  return clamp(1 - closest / 40, 0, 1)
}

function harmonyScoreFromDistance(distance) {
  const direct = gaussian(distance, 0, 40)
  const analogous = gaussian(distance, 30, 20)
  const triadic = gaussian(distance, 120, 24)
  const complementary = gaussian(distance, 180, 18)

  return Math.max(direct, analogous * 0.8, triadic * 0.9, complementary * 0.95)
}

function gaussian(value, center, spread) {
  const x = (value - center) / spread
  return Math.exp(-(x * x) / 2)
}

function normalizeHue(hue) {
  if (!Number.isFinite(hue)) return Number.NaN
  const normalized = hue % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

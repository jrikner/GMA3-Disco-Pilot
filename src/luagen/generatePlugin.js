/**
 * GrandMA3 LUA Plugin Generator
 *
 * Generates a .lua script that, when imported and run as a Plugin in MA3,
 * creates all the sequences and executors the Disco Pilot app needs.
 *
 * MA3 API used: v2.x (gma.cmd(), gma.show.getobj(), gma.show.createobj())
 *
 * What is created:
 *   - 8 color look sequences (one per genre), assigned to the declared free executors
 *   - phaser sequences (ptSlow, optional ptFast/panOnly/tiltOnly, colorChase, dimPulse)
 *   - 1 BPM Rate Master executor
 *   - 1 Effect Size Master executor
 *
 * Color cues: static cues with Hue/Saturation/Brightness or raw RGB, respecting user preferences
 * Phasers: built using MA3's Effect Engine (P/T = sine wave, dimmer = square wave)
 */

import { GENRE_PROFILES } from '../profiles/genreProfiles.js'
import { buildCueFriendlyPalette } from '../profiles/paletteAdapter.js'

/**
 * @param {Object} config
 * @param {Array}  config.fixtureGroups    - from session.fixtureGroups
 * @param {Array}  config.avoidColors      - [{ h, s, l, label }]
 * @param {Array}  config.emphasizeColors  - [{ h, s, l, label }]
 * @param {number} config.page             - executor page
 * @param {number} config.startExec        - first executor number
 * @returns {string} LUA script content
 */
export function generatePlugin(config) {
  const {
    fixtureGroups,
    avoidColors,
    emphasizeColors,
    page,
    startExec,
    phaserConfig = {},
    positionPreset,
  } = config

  const lines = []
  const genres = ['techno', 'edm', 'hiphop', 'pop', 'eighties', 'latin', 'rock', 'corporate']

  // Header comment
  lines.push(lua`-- GMA3 Disco Pilot — Generated Plugin`)
  lines.push(lua`-- Generated: ${new Date().toISOString()}`)
  lines.push(lua`-- DO NOT EDIT — regenerate via the Disco Pilot app`)
  lines.push(``)
  lines.push(`local function main()`)
  lines.push(`  Cmd("BlindEdit On")`)
  lines.push(``)

  let exec = startExec

  // ── Color Look Sequences ────────────────────────────────────────────────────
  lines.push(`  -- ╔══════════════════════════════════════╗`)
  lines.push(`  -- ║  Color Look Sequence (cue-per-genre)  ║`)
  lines.push(`  -- ╚══════════════════════════════════════╝`)
  lines.push(``)

  const colorLookSequenceName = "DP_COLOR_LOOKS"
  const colorLookSequenceNameEscaped = escapeLuaString(colorLookSequenceName)

  lines.push(`  -- Shared color sequence (Page ${page}, Exec ${exec})`)
  lines.push(`  Cmd("Store Sequence \\"${colorLookSequenceNameEscaped}\\"")`)
  lines.push(`  Cmd("Label Sequence \\"${colorLookSequenceNameEscaped}\\" \\"DP Color Looks\\"")`)
  lines.push(``)

  for (const [genreIndex, genreId] of genres.entries()) {
    const profile = GENRE_PROFILES[genreId]
    const colors = selectColors(profile.colorPalette.colors, avoidColors, emphasizeColors)
    const cueNum = genreIndex + 1

    lines.push(`  -- Cue ${cueNum}: ${profile.label}`)
    lines.push(`  Cmd("ClearAll")`)

    // Select all relevant groups for this look
    for (const group of fixtureGroups) {
      lines.push(`  Cmd("SelFix Group \\"${escapeLuaString(group.maGroupName)}\\"")`)
    }

    if (fixtureGroups.some(g => g.attributes.rgb)) {
      // Blend genre palette into a single representative color
      const blended = blendColors(colors)
      lines.push(`  Cmd("Attribute \\"Hue\\" at ${blended.h}")`)
      lines.push(`  Cmd("Attribute \\"Saturation\\" at ${blended.s}")`)
      lines.push(`  Cmd("Attribute \\"Dimmer\\" at 100")`)
    }

    if (fixtureGroups.some(g => g.attributes.colorWheel)) {
      const blended = blendColors(colors)
      const wheelSlot = hslToWheelSlot(blended.h, blended.s)
      lines.push(`  Cmd("Attribute \\"Color1\\" at ${wheelSlot}")`)
    }

    lines.push(`  Cmd("Store Sequence \\"${colorLookSequenceNameEscaped}\\" Cue ${cueNum} Merge")`)
    lines.push(`  Cmd("Label Cue ${cueNum} Sequence \\"${colorLookSequenceNameEscaped}\\" \\"${escapeLuaString(profile.label)}\\"")`)
    lines.push(`  Cmd("Cue ${cueNum} Sequence \\"${colorLookSequenceNameEscaped}\\" property \\"FadeTime\\" 2")`)
    lines.push(``)
  }

  lines.push(`  Cmd("Assign Sequence \\"${colorLookSequenceNameEscaped}\\" at Page ${page} Exec ${exec}")`)
  lines.push(`  Cmd("Assign Sequence \\"${colorLookSequenceNameEscaped}\\" fadermaster")`)
  lines.push(``)
  exec++

  // ── Phaser Sequences ────────────────────────────────────────────────────────
  lines.push(`  -- ╔══════════════════════════════╗`)
  lines.push(`  -- ║  Phaser Sequences             ║`)
  lines.push(`  -- ╚══════════════════════════════╝`)
  lines.push(``)

  const moverGroups = fixtureGroups.filter(g => g.attributes.pt)
  const rgbGroups = fixtureGroups.filter(g => g.attributes.rgb || g.attributes.colorWheel)
  const dimGroups = fixtureGroups

  const hasPositionPreset = Number.isInteger(positionPreset) && positionPreset > 0
  if (hasPositionPreset && moverGroups.length > 0) {
    lines.push(`  -- Apply shared base position preset (Preset 2.${positionPreset}) before motion cues`)
    for (const group of moverGroups) {
      lines.push(`  Cmd("SelFix Group \"${escapeLuaString(group.maGroupName)}\"")`)
    }
    lines.push(`  Cmd("At Preset 2.${positionPreset}")`)
    lines.push(``)
  }

  const {
    includePtFast = true,
    includePanOnly = true,
    includeTiltOnly = true,
  } = phaserConfig

  // Pan/Tilt movement phasers
  if (moverGroups.length > 0) {
    lines.push(`  -- P/T Slow Phaser (Page ${page}, Exec ${exec})`)
    lines.push(`  Cmd("Store Sequence \"DP_PHASER_PT_SLOW\"")`)
    lines.push(`  Cmd("Label Sequence \"DP_PHASER_PT_SLOW\" \"DP Phaser PT Slow\"")`)
    for (const group of moverGroups) {
      lines.push(`  Cmd("SelFix Group \"${group.maGroupName}\"")`)
    }
    lines.push(`  Cmd("Attribute \"Pan\" Effect Sinus Width 30 Rate 0.3")`)
    lines.push(`  Cmd("Attribute \"Tilt\" Effect Sinus Width 25 Rate 0.3 Phase 90")`)
    lines.push(`  Cmd("Store Sequence \"DP_PHASER_PT_SLOW\" Cue 1 Merge")`)
    lines.push(`  Cmd("Assign Sequence \"DP_PHASER_PT_SLOW\" at Page ${page} Exec ${exec}")`)
    lines.push(``)
    exec++

    if (includePtFast) {
      lines.push(`  -- P/T Fast Phaser (Page ${page}, Exec ${exec})`)
      lines.push(`  Cmd("Store Sequence \"DP_PHASER_PT_FAST\"")`)
      lines.push(`  Cmd("Label Sequence \"DP_PHASER_PT_FAST\" \"DP Phaser PT Fast\"")`)
      for (const group of moverGroups) {
        lines.push(`  Cmd("SelFix Group \"${group.maGroupName}\"")`)
      }
      lines.push(`  Cmd("Attribute \"Pan\" Effect Sinus Width 45 Rate 1.2")`)
      lines.push(`  Cmd("Attribute \"Tilt\" Effect Sinus Width 35 Rate 1.2 Phase 90")`)
      lines.push(`  Cmd("Store Sequence \"DP_PHASER_PT_FAST\" Cue 1 Merge")`)
      lines.push(`  Cmd("Assign Sequence \"DP_PHASER_PT_FAST\" at Page ${page} Exec ${exec}")`)
      lines.push(``)
      exec++
    }

    if (includePanOnly) {
      lines.push(`  -- Pan-only Phaser (Page ${page}, Exec ${exec})`)
      lines.push(`  Cmd("Store Sequence \"DP_PHASER_PAN_ONLY\"")`)
      for (const group of moverGroups) {
        lines.push(`  Cmd("SelFix Group \"${group.maGroupName}\"")`)
      }
      lines.push(`  Cmd("Attribute \"Pan\" Effect Sinus Width 45 Rate 1")`)
      lines.push(`  Cmd("Store Sequence \"DP_PHASER_PAN_ONLY\" Cue 1 Merge")`)
      lines.push(`  Cmd("Assign Sequence \"DP_PHASER_PAN_ONLY\" at Page ${page} Exec ${exec}")`)
      lines.push(``)
      exec++
    }

    if (includeTiltOnly) {
      lines.push(`  -- Tilt-only Phaser (Page ${page}, Exec ${exec})`)
      lines.push(`  Cmd("Store Sequence \"DP_PHASER_TILT_ONLY\"")`)
      for (const group of moverGroups) {
        lines.push(`  Cmd("SelFix Group \"${group.maGroupName}\"")`)
      }
      lines.push(`  Cmd("Attribute \"Tilt\" Effect Sinus Width 35 Rate 1")`)
      lines.push(`  Cmd("Store Sequence \"DP_PHASER_TILT_ONLY\" Cue 1 Merge")`)
      lines.push(`  Cmd("Assign Sequence \"DP_PHASER_TILT_ONLY\" at Page ${page} Exec ${exec}")`)
      lines.push(``)
      exec++
    }
  } else {
    lines.push(`  -- Skipping mover phasers (no Pan/Tilt groups defined)`)
  }

  // Color Chase phaser
  if (rgbGroups.length > 0) {
    lines.push(`  -- Color Chase (Page ${page}, Exec ${exec})`)
    lines.push(`  Cmd("Store Sequence \\"DP_PHASER_COLOR\\"")`)
    lines.push(`  Cmd("Label Sequence \\"DP_PHASER_COLOR\\" \\"DP Color Chase\\"")`)
    for (const group of rgbGroups) {
      lines.push(`  Cmd("SelFix Group \\"${group.maGroupName}\\"")`)
    }
    lines.push(`  Cmd("Attribute \\"Hue\\" Effect Sinus Width 180 Rate 0.5")`)
    lines.push(`  Cmd("Store Sequence \\"DP_PHASER_COLOR\\" Cue 1 Merge")`)
    lines.push(`  Cmd("Assign Sequence \\"DP_PHASER_COLOR\\" at Page ${page} Exec ${exec}")`)
    lines.push(``)
    exec++
  } else {
    exec++
  }

  // Dimmer Pulse phaser
  lines.push(`  -- Dimmer Pulse (Page ${page}, Exec ${exec})`)
  lines.push(`  Cmd("Store Sequence \\"DP_PHASER_DIM\\"")`)
  lines.push(`  Cmd("Label Sequence \\"DP_PHASER_DIM\\" \\"DP Dimmer Pulse\\"")`)
  for (const group of dimGroups) {
    lines.push(`  Cmd("SelFix Group \\"${group.maGroupName}\\"")`)
  }
  lines.push(`  Cmd("Attribute \\"Dimmer\\" Effect Square Width 50 Rate 1")`)
  lines.push(`  Cmd("Store Sequence \\"DP_PHASER_DIM\\" Cue 1 Merge")`)
  lines.push(`  Cmd("Assign Sequence \\"DP_PHASER_DIM\\" at Page ${page} Exec ${exec}")`)
  lines.push(``)
  exec++

  // ── Masters ──────────────────────────────────────────────────────────────────
  lines.push(`  -- ╔══════════════╗`)
  lines.push(`  -- ║  Masters     ║`)
  lines.push(`  -- ╚══════════════╝`)
  lines.push(``)

  lines.push(`  -- BPM Rate Master (Page ${page}, Exec ${exec})`)
  lines.push(`  -- The Disco Pilot app sends BPM values to this executor's fader.`)
  lines.push(`  -- After running: right-click the executor in MA3 → set type to "SpeedMaster"`)
  lines.push(`  -- so that all sequences using this SpeedMaster follow the BPM.`)
  lines.push(`  Cmd("Store Sequence \\"DP_RATE_MASTER\\"")`)
  lines.push(`  Cmd("Label Sequence \\"DP_RATE_MASTER\\" \\"DP Rate Master\\"")`)
  lines.push(`  Cmd("Assign Sequence \\"DP_RATE_MASTER\\" at Page ${page} Exec ${exec}")`)
  lines.push(`  -- Cmd("Assign SpeedMaster 1 at Page ${page} Exec ${exec}")  -- uncomment if SpeedMaster assignment is preferred`)
  lines.push(``)
  exec++

  lines.push(`  -- Effect Size Master (Page ${page}, Exec ${exec})`)
  lines.push(`  -- After running: right-click the executor → set type to "SizeMaster"`)
  lines.push(`  -- so that all effect sequences scale their amplitude with this fader.`)
  lines.push(`  Cmd("Store Sequence \\"DP_FX_MASTER\\"")`)
  lines.push(`  Cmd("Label Sequence \\"DP_FX_MASTER\\" \\"DP Effect Size\\"")`)
  lines.push(`  Cmd("Assign Sequence \\"DP_FX_MASTER\\" at Page ${page} Exec ${exec}")`)
  lines.push(`  -- Cmd("Assign SizeMaster 1 at Page ${page} Exec ${exec}")  -- uncomment if SizeMaster assignment is preferred`)
  lines.push(``)
  exec++

  lines.push(`  Cmd("BlindEdit Off")`)
  lines.push(`  Echo("Disco Pilot: Setup complete! ${exec - startExec} executors created on Page ${page}.")`)
  lines.push(`end`)
  lines.push(``)
  lines.push(`return main`)

  return lines.join('\n')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Template tag — just returns the string (for syntax highlighting hints) */
function lua(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
}

function escapeLuaString(value) {
  return String(value)
    .replaceAll('\\', '\\\\\\\\')
    .replaceAll('"', '\\\\\\"')
}

/**
 * Build a cue-friendly palette from the genre profile and user constraints.
 */
function selectColors(palette, avoidColors, emphasizeColors) {
  const filtered = palette.filter(c =>
    !avoidColors.some(a => hueDist(c.h, a.h) < 30)
  )

  const emphasized = emphasizeColors.filter(e =>
    !avoidColors.some(a => hueDist(e.h, a.h) < 30)
  )

  const merged = [...emphasized, ...filtered]

  // Ensure at least 1 color
  if (merged.length === 0) {
    return [{ h: 200, s: 30, l: 60, label: 'Neutral' }]
  }

  // Cap at 6 colors
  return merged.slice(0, 6)
}

function blendColors(colors) {
  if (!colors || colors.length === 0) return { h: 200, s: 30, l: 60 }

  let x = 0
  let y = 0
  let sat = 0
  let light = 0

  for (const color of colors) {
    const rad = (color.h * Math.PI) / 180
    x += Math.cos(rad)
    y += Math.sin(rad)
    sat += color.s
    light += color.l
  }

  const h = (Math.atan2(y, x) * 180) / Math.PI
  const normalizedHue = (h + 360) % 360
  return {
    h: Math.round(normalizedHue),
    s: Math.round(sat / colors.length),
    l: Math.round(light / colors.length),
  }
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Map an HSL color to a color wheel gobo slot (very rough approximation).
 * Real implementation would need the fixture's actual color wheel layout.
 */
function hslToWheelSlot(h, s) {
  if (s < 20) return 0  // Open/white
  if (h < 30 || h > 330) return 1   // Red
  if (h < 75) return 2              // Amber/yellow
  if (h < 150) return 3             // Green
  if (h < 200) return 4             // Cyan
  if (h < 260) return 5             // Blue
  if (h < 310) return 6             // Violet
  return 7                          // Magenta/UV
}


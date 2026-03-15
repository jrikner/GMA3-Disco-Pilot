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
 *   - 4 phaser sequences (ptSlow, ptFast, colorChase, dimPulse), for groups with P/T and RGB
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
  const { fixtureGroups, avoidColors, emphasizeColors, page, startExec } = config

  const lines = []
  const genres = ['techno', 'edm', 'hiphop', 'pop', 'eighties', 'latin', 'rock', 'corporate']

  // Header comment
  lines.push(lua`-- GMA3 Disco Pilot — Generated Plugin`)
  lines.push(lua`-- Generated: ${new Date().toISOString()}`)
  lines.push(lua`-- DO NOT EDIT — regenerate via the Disco Pilot app`)
  lines.push(``)
  lines.push(`local function main()`)
  lines.push(`  gma.cmd("BlindEdit On")`)
  lines.push(``)

  let exec = startExec

  // ── Color Look Sequences ────────────────────────────────────────────────────
  lines.push(`  -- ╔══════════════════════════════════════╗`)
  lines.push(`  -- ║  Color Look Sequences (1 per genre)  ║`)
  lines.push(`  -- ╚══════════════════════════════════════╝`)
  lines.push(``)

  for (const genreId of genres) {
    const profile = GENRE_PROFILES[genreId]
    const seqName = `DP_${genreId.toUpperCase()}`
    const colors = selectColors(genreId, avoidColors, emphasizeColors)

    lines.push(`  -- ${profile.label} (Page ${page}, Exec ${exec})`)
    lines.push(`  gma.cmd("Store Sequence \\"${seqName}\\"")`)
    lines.push(`  gma.cmd("Label Sequence \\"${seqName}\\" \\"${profile.label}\\"")`)

    // Create one cue per color, plus a home cue
    colors.forEach((color, i) => {
      const { h, s, l } = color
      const cueNum = i + 1
      lines.push(`  gma.cmd("ClearAll")`)
      // Select all relevant groups for this look
      for (const group of fixtureGroups) {
        lines.push(`  gma.cmd("SelFix Group \\"${group.maGroupName}\\"")`)
      }
      if (fixtureGroups.some(g => g.attributes.rgb)) {
        // RGB fixtures: set HSB color
        lines.push(`  gma.cmd("Attribute \\"Hue\\" at ${h}")`)
        lines.push(`  gma.cmd("Attribute \\"Saturation\\" at ${s}")`)
        lines.push(`  gma.cmd("Attribute \\"Dimmer\\" at 100")`)
      }
      if (fixtureGroups.some(g => g.attributes.colorWheel)) {
        // Color wheel: find closest slot (simplified — uses first slot index)
        const wheelSlot = hslToWheelSlot(h, s)
        lines.push(`  gma.cmd("Attribute \\"Color1\\" at ${wheelSlot}")`)
      }
      lines.push(`  gma.cmd("Store Sequence \\"${seqName}\\" Cue ${cueNum} Merge")`)
      lines.push(`  gma.cmd("Label Cue ${cueNum} Sequence \\"${seqName}\\" \\"${color.label || `Color ${cueNum}`}\\"")`)
      lines.push(`  gma.cmd("Cue ${cueNum} Sequence \\"${seqName}\\" property \\"FadeTime\\" 2")`)
      lines.push(``)
    })

    // Set playback mode to Master Fader
    lines.push(`  gma.cmd("Assign Sequence \\"${seqName}\\" at Page ${page} Exec ${exec}")`)
    lines.push(`  gma.cmd("Assign Sequence \\"${seqName}\\" fadermaster")`)
    lines.push(``)
    exec++
  }

  // ── Phaser Sequences ────────────────────────────────────────────────────────
  lines.push(`  -- ╔══════════════════════════════╗`)
  lines.push(`  -- ║  Phaser Sequences             ║`)
  lines.push(`  -- ╚══════════════════════════════╝`)
  lines.push(``)

  const moverGroups = fixtureGroups.filter(g => g.attributes.pt)
  const rgbGroups = fixtureGroups.filter(g => g.attributes.rgb || g.attributes.colorWheel)
  const dimGroups = fixtureGroups

  // Pan/Tilt Slow phaser
  if (moverGroups.length > 0) {
    lines.push(`  -- P/T Slow Phaser (Page ${page}, Exec ${exec})`)
    lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_PT_SLOW\\"")`)
    lines.push(`  gma.cmd("Label Sequence \\"DP_PHASER_PT_SLOW\\" \\"DP Phaser PT Slow\\"")`)
    for (const group of moverGroups) {
      lines.push(`  gma.cmd("SelFix Group \\"${group.maGroupName}\\"")`)
    }
    lines.push(`  gma.cmd("Attribute \\"Pan\\" Effect Sinus Width 30 Rate 0.3")`)
    lines.push(`  gma.cmd("Attribute \\"Tilt\\" Effect Sinus Width 25 Rate 0.3 Phase 90")`)
    lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_PT_SLOW\\" Cue 1 Merge")`)
    lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_PT_SLOW\\" at Page ${page} Exec ${exec}")`)
    lines.push(``)
    exec++

    // Pan/Tilt Fast phaser
    lines.push(`  -- P/T Fast Phaser (Page ${page}, Exec ${exec})`)
    lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_PT_FAST\\"")`)
    lines.push(`  gma.cmd("Label Sequence \\"DP_PHASER_PT_FAST\\" \\"DP Phaser PT Fast\\"")`)
    for (const group of moverGroups) {
      lines.push(`  gma.cmd("SelFix Group \\"${group.maGroupName}\\"")`)
    }
    lines.push(`  gma.cmd("Attribute \\"Pan\\" Effect Sinus Width 45 Rate 1.2")`)
    lines.push(`  gma.cmd("Attribute \\"Tilt\\" Effect Sinus Width 35 Rate 1.2 Phase 90")`)
    lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_PT_FAST\\" Cue 1 Merge")`)
    lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_PT_FAST\\" at Page ${page} Exec ${exec}")`)
    lines.push(``)
    exec++
  } else {
    // No movers: skip P/T phaser slots but still increment exec to keep map consistent
    lines.push(`  -- Skipping P/T phasers (no Pan/Tilt groups defined)`)
    exec += 2
  }

  // Color Chase phaser
  if (rgbGroups.length > 0) {
    lines.push(`  -- Color Chase (Page ${page}, Exec ${exec})`)
    lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_COLOR\\"")`)
    lines.push(`  gma.cmd("Label Sequence \\"DP_PHASER_COLOR\\" \\"DP Color Chase\\"")`)
    for (const group of rgbGroups) {
      lines.push(`  gma.cmd("SelFix Group \\"${group.maGroupName}\\"")`)
    }
    lines.push(`  gma.cmd("Attribute \\"Hue\\" Effect Sinus Width 180 Rate 0.5")`)
    lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_COLOR\\" Cue 1 Merge")`)
    lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_COLOR\\" at Page ${page} Exec ${exec}")`)
    lines.push(``)
    exec++
  } else {
    exec++
  }

  // Dimmer Pulse phaser
  lines.push(`  -- Dimmer Pulse (Page ${page}, Exec ${exec})`)
  lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_DIM\\"")`)
  lines.push(`  gma.cmd("Label Sequence \\"DP_PHASER_DIM\\" \\"DP Dimmer Pulse\\"")`)
  for (const group of dimGroups) {
    lines.push(`  gma.cmd("SelFix Group \\"${group.maGroupName}\\"")`)
  }
  lines.push(`  gma.cmd("Attribute \\"Dimmer\\" Effect Square Width 50 Rate 1")`)
  lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_DIM\\" Cue 1 Merge")`)
  lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_DIM\\" at Page ${page} Exec ${exec}")`)
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
  lines.push(`  gma.cmd("Store Sequence \\"DP_RATE_MASTER\\"")`)
  lines.push(`  gma.cmd("Label Sequence \\"DP_RATE_MASTER\\" \\"DP Rate Master\\"")`)
  lines.push(`  gma.cmd("Assign Sequence \\"DP_RATE_MASTER\\" at Page ${page} Exec ${exec}")`)
  lines.push(`  -- gma.cmd("Assign SpeedMaster 1 at Page ${page} Exec ${exec}")  -- uncomment if SpeedMaster assignment is preferred`)
  lines.push(``)
  exec++

  lines.push(`  -- Effect Size Master (Page ${page}, Exec ${exec})`)
  lines.push(`  -- After running: right-click the executor → set type to "SizeMaster"`)
  lines.push(`  -- so that all effect sequences scale their amplitude with this fader.`)
  lines.push(`  gma.cmd("Store Sequence \\"DP_FX_MASTER\\"")`)
  lines.push(`  gma.cmd("Label Sequence \\"DP_FX_MASTER\\" \\"DP Effect Size\\"")`)
  lines.push(`  gma.cmd("Assign Sequence \\"DP_FX_MASTER\\" at Page ${page} Exec ${exec}")`)
  lines.push(`  -- gma.cmd("Assign SizeMaster 1 at Page ${page} Exec ${exec}")  -- uncomment if SizeMaster assignment is preferred`)
  lines.push(``)
  exec++

  lines.push(`  gma.cmd("BlindEdit Off")`)
  lines.push(`  gma.echo("Disco Pilot: Setup complete! ${exec - startExec} executors created on Page ${page}.")`)
  lines.push(`end`)
  lines.push(``)
  lines.push(`main()`)

  return lines.join('\n')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Template tag — just returns the string (for syntax highlighting hints) */
function lua(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
}

/**
 * Build a cue-friendly palette from the genre profile and user constraints.
 */
function selectColors(genreId, avoidColors, emphasizeColors) {
  return buildCueFriendlyPalette(genreId, {
    avoidColors,
    emphasizeColors,
    maxColors: 6,
  })
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

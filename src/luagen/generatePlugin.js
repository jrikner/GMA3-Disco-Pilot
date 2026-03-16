/**
 * GrandMA3 LUA Plugin Generator
 */

import { GENRE_PROFILES } from '../profiles/genreProfiles.js'
import {
  assignSequence,
  assignSequenceOption,
  attributeAt,
  clearAll,
  cmd,
  cueProperty,
  labelCue,
  labelSequence,
  selectGroup,
  storeSequence,
} from './ma3CommandBuilders.js'

export function generatePlugin(config) {
  const {
    fixtureGroups,
    avoidColors,
    emphasizeColors,
    page,
    startExec,
  } = config

  const lines = []
  const genres = ['techno', 'edm', 'hiphop', 'pop', 'eighties', 'latin', 'rock', 'corporate']

  lines.push(lua`-- GMA3 Disco Pilot — Generated Plugin`)
  lines.push(lua`-- Generated: ${new Date().toISOString()}`)
  lines.push(lua`-- DO NOT EDIT — regenerate via the Disco Pilot app`)
  lines.push(``)
  lines.push(`local function main()`)
  lines.push(cmd('BlindEdit On'))
  lines.push(``)

  let exec = startExec

  lines.push(`  -- ╔══════════════════════════════════════╗`)
  lines.push(`  -- ║  Color Look Sequences (1 per genre)  ║`)
  lines.push(`  -- ╚══════════════════════════════════════╝`)
  lines.push(``)

  for (const genreId of genres) {
    const profile = GENRE_PROFILES[genreId]
    const seqName = `DP_${genreId.toUpperCase()}`
    const colors = selectColors(profile.colorPalette.colors, avoidColors, emphasizeColors)

    lines.push(`  -- ${profile.label} (Page ${page}, Exec ${exec})`)
    lines.push(storeSequence(seqName))
    lines.push(labelSequence(seqName, profile.label))

    colors.forEach((color, i) => {
      const { h, s } = color
      const cueNum = i + 1
      lines.push(clearAll())
      for (const group of fixtureGroups) {
        lines.push(selectGroup(group.maGroupName))
      }
      if (fixtureGroups.some(g => g.attributes.rgb)) {
        lines.push(attributeAt('Hue', h))
        lines.push(attributeAt('Saturation', s))
        lines.push(attributeAt('Dimmer', 100))
      }
      if (fixtureGroups.some(g => g.attributes.colorWheel)) {
        const wheelSlot = hslToWheelSlot(h, s)
        lines.push(attributeAt('Color1', wheelSlot))
      }
      lines.push(storeSequence(seqName, cueNum, 'Merge'))
      lines.push(labelCue(seqName, cueNum, color.label || `Color ${cueNum}`))
      lines.push(cueProperty(seqName, cueNum, 'FadeTime', 2))
      lines.push(``)
    })

    lines.push(assignSequence(seqName, `Page ${page} Exec ${exec}`))
    lines.push(assignSequenceOption(seqName, 'fadermaster'))
    lines.push(``)
    exec++
  }

  lines.push(`  -- ╔══════════════╗`)
  lines.push(`  -- ║  Masters     ║`)
  lines.push(`  -- ╚══════════════╝`)
  lines.push(``)

  lines.push(`  -- BPM Rate Master (Page ${page}, Exec ${exec})`)
  lines.push(storeSequence('DP_RATE_MASTER'))
  lines.push(labelSequence('DP_RATE_MASTER', 'DP Rate Master'))
  lines.push(assignSequence('DP_RATE_MASTER', `Page ${page} Exec ${exec}`))
  lines.push(``)
  exec++

  lines.push(`  -- Effect Size Master (Page ${page}, Exec ${exec})`)
  lines.push(storeSequence('DP_FX_MASTER'))
  lines.push(labelSequence('DP_FX_MASTER', 'DP Effect Size'))
  lines.push(assignSequence('DP_FX_MASTER', `Page ${page} Exec ${exec}`))
  lines.push(``)
  exec++

  lines.push(cmd('BlindEdit Off'))
  lines.push(`  gma.echo("Disco Pilot: Setup complete! ${exec - startExec} executors created on Page ${page}.")`)
  lines.push(`end`)
  lines.push(``)
  lines.push(`main()`)

  return lines.join('\n')
}

function lua(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
}

function selectColors(palette, avoidColors, emphasizeColors) {
  const filtered = palette.filter(c =>
    !avoidColors.some(a => hueDist(c.h, a.h) < 30)
  )

  const emphasized = emphasizeColors.filter(e =>
    !avoidColors.some(a => hueDist(e.h, a.h) < 30)
  )

  const merged = [...emphasized, ...filtered]

  if (merged.length === 0) {
    return [{ h: 200, s: 30, l: 60, label: 'Neutral' }]
  }

  return merged.slice(0, 6)
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function hslToWheelSlot(h) {
  return Math.max(1, Math.min(12, Math.round((h / 360) * 12)))
}

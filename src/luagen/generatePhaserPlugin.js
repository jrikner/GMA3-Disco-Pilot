/**
 * GrandMA3 Phaser Plugin Generator.
 */

import {
  applyPreset,
  assignSequence,
  attributeAt,
  attributePhaser,
  clearAll,
  cmd,
  cueProperty,
  selectGroup,
  storeSequence,
} from './ma3CommandBuilders.js'

export function generatePhaserPlugin(config) {
  const { fixtureGroups, page, phaserExecStart, selectedPresetRefs = {} } = config

  const moverGroups = fixtureGroups.filter(g => g.attributes?.pt)
  const rgbGroups = fixtureGroups.filter(g => g.attributes?.rgb || g.attributes?.colorWheel)
  const allGroups = fixtureGroups

  const lines = []
  let exec = phaserExecStart

  lines.push(`-- GMA3 Disco Pilot — PHASER SETUP PLUGIN`)
  lines.push(`-- Generated: ${new Date().toISOString()}`)
  lines.push(`-- Run this AFTER running the main Disco Pilot plugin.`)
  lines.push(`-- TEST IN OFFLINE/BLIND MODE FIRST.`)
  lines.push(``)
  lines.push(`local function main()`)
  lines.push(cmd('BlindEdit On'))
  lines.push(`  gma.echo("Disco Pilot: Setting up phasers...")`)
  lines.push(``)

  if (moverGroups.length > 0) {
    lines.push(`  -- Pan/Tilt SLOW Phaser  (Page ${page}, Exec ${exec})`)
    lines.push(clearAll())
    for (const g of moverGroups) lines.push(selectGroup(g.maGroupName))
    if (selectedPresetRefs.ptSlow) {
      lines.push(`  -- Apply selected movement preset from showfile context`)
      lines.push(applyPreset(selectedPresetRefs.ptSlow))
    }
    lines.push(attributePhaser('Pan'))
    lines.push(attributePhaser('Tilt'))
    lines.push(storeSequence('DP_PHASER_PT_SLOW', 1, 'Merge'))
    lines.push(assignSequence('DP_PHASER_PT_SLOW', `Page ${page} Exec ${exec}`))
    lines.push(``)

    lines.push(`  --[[ STEP-CHASE ALTERNATIVE`)
    lines.push(clearAll())
    for (const g of moverGroups) lines.push(selectGroup(g.maGroupName))
    const panPositions = [50,56,62,68,74,80,74,68,62,56,50,44,38,32,38,44]
    panPositions.forEach((pos, i) => {
      lines.push(attributeAt('Pan', pos))
      lines.push(storeSequence('DP_PHASER_PT_SLOW', i + 1, 'Merge'))
      lines.push(cueProperty('DP_PHASER_PT_SLOW', i + 1, 'FadeTime', 0.3))
    })
    lines.push(assignSequence('DP_PHASER_PT_SLOW', `Page ${page} Exec ${exec}`))
    lines.push(`  --]]`)
    lines.push(``)
    exec++

    lines.push(`  -- Pan/Tilt FAST Phaser  (Page ${page}, Exec ${exec})`)
    lines.push(clearAll())
    for (const g of moverGroups) lines.push(selectGroup(g.maGroupName))
    if (selectedPresetRefs.ptFast) {
      lines.push(`  -- Apply selected movement preset from showfile context`)
      lines.push(applyPreset(selectedPresetRefs.ptFast))
    }
    lines.push(attributePhaser('Pan'))
    lines.push(attributePhaser('Tilt'))
    lines.push(storeSequence('DP_PHASER_PT_FAST', 1, 'Merge'))
    lines.push(assignSequence('DP_PHASER_PT_FAST', `Page ${page} Exec ${exec}`))
    lines.push(``)
    exec++
  } else {
    lines.push(`  -- No Pan/Tilt groups defined — skipping P/T phasers (exec ${exec} and ${exec + 1})`)
    exec += 2
  }

  if (rgbGroups.length > 0) {
    lines.push(`  -- Color Chase Phaser    (Page ${page}, Exec ${exec})`)
    lines.push(clearAll())
    for (const g of rgbGroups) lines.push(selectGroup(g.maGroupName))
    if (selectedPresetRefs.colorChase) {
      lines.push(`  -- Apply selected color preset from showfile context`)
      lines.push(applyPreset(selectedPresetRefs.colorChase))
    }
    lines.push(attributePhaser('Hue'))
    lines.push(storeSequence('DP_PHASER_COLOR', 1, 'Merge'))
    lines.push(assignSequence('DP_PHASER_COLOR', `Page ${page} Exec ${exec}`))
  } else {
    lines.push(`  -- No RGB groups — skipping color chase (exec ${exec})`)
  }
  lines.push(``)
  exec++

  lines.push(`  -- Dimmer Pulse Phaser    (Page ${page}, Exec ${exec})`)
  lines.push(clearAll())
  for (const g of allGroups) lines.push(selectGroup(g.maGroupName))
  if (selectedPresetRefs.dimPulse) {
    lines.push(`  -- Apply selected dimmer preset from showfile context`)
    lines.push(applyPreset(selectedPresetRefs.dimPulse))
  }
  lines.push(attributePhaser('Dimmer'))
  lines.push(storeSequence('DP_PHASER_DIM', 1, 'Merge'))
  lines.push(assignSequence('DP_PHASER_DIM', `Page ${page} Exec ${exec}`))
  lines.push(``)

  lines.push(cmd('BlindEdit Off'))
  lines.push(`  gma.echo("Disco Pilot Phasers: Done. Check sequences in Effect Engine to verify/adjust.")`)
  lines.push(`end`)
  lines.push(``)
  lines.push(`main()`)

  return lines.join('\n')
}

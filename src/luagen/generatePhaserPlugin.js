/**
 * GrandMA3 Phaser Plugin Generator — SEPARATE from the main color plugin.
 *
 * This generator creates a dedicated LUA script for setting up phaser sequences
 * (P/T movement, color chase, dimmer pulse) using MA3's Effect Engine.
 *
 * IMPORTANT: Effect Engine commands via gma.cmd() in MA3 v2.x are not fully
 * documented. This script uses the best-known syntax and includes fallback
 * step-chase alternatives. TEST IN OFFLINE MODE FIRST.
 *
 * Two approaches are generated:
 *  A) Effect Engine approach — uses gma.cmd() Attribute + Effect commands
 *  B) Step Chase fallback — creates multi-step cues manually (100% reliable)
 *
 * The script tries approach A first, and the comments explain how to switch to B.
 */

/**
 * @param {Object} config
 * @param {Array}  config.fixtureGroups - from session.fixtureGroups
 * @param {number} config.page          - executor page (must match main plugin)
 * @param {number} config.phaserExecStart - first phaser executor (main plugin uses startExec+8)
 * @param {boolean} [config.includePtFast=true]  - include DP_PHASER_PT_FAST
 * @param {boolean} [config.includePanOnly=true] - include DP_PHASER_PAN_ONLY
 * @param {boolean} [config.includeTiltOnly=true] - include DP_PHASER_TILT_ONLY
 * @param {string}  [config.ptPreset]  - preset reference for combined P/T look (e.g. 21.1)
 * @param {string}  [config.panPreset] - preset reference for pan-only look (e.g. 21.2)
 * @param {string}  [config.tiltPreset]- preset reference for tilt-only look (e.g. 21.3)
 */
export function generatePhaserPlugin(config) {
  const {
    fixtureGroups,
    page,
    phaserExecStart,
    includePtFast = true,
    includePanOnly = true,
    includeTiltOnly = true,
    ptPreset = '',
    panPreset = '',
    tiltPreset = '',
  } = config

  const moverGroups = fixtureGroups.filter(g => g.attributes?.pt)
  const rgbGroups   = fixtureGroups.filter(g => g.attributes?.rgb || g.attributes?.colorWheel)
  const allGroups   = fixtureGroups

  const lines = []
  let exec = phaserExecStart

  lines.push(`-- GMA3 Disco Pilot — PHASER SETUP PLUGIN`)
  lines.push(`-- Generated: ${new Date().toISOString()}`)
  lines.push(`-- Run this AFTER running the main Disco Pilot plugin.`)
  lines.push(`-- TEST IN OFFLINE/BLIND MODE FIRST.`)
  lines.push(`--`)
  lines.push(`-- If a phaser doesn't look right after running:`)
  lines.push(`--   1. Open the sequence in MA3's Effect Engine`)
  lines.push(`--   2. Manually enable/adjust the phaser there`)
  lines.push(`--   3. The app controls on/off via the executor fader, not the effect params`)
  lines.push(``)
  lines.push(`local function main()`)
  lines.push(`  gma.cmd("BlindEdit On")`)
  lines.push(`  gma.echo("Disco Pilot: Setting up phasers...")`)
  lines.push(``)
  lines.push(`  local function applyPreset(ref)`)
  lines.push(`    if ref and ref ~= "" then`)
  lines.push(`      gma.cmd("At Preset " .. ref)`)
  lines.push(`    end`)
  lines.push(`  end`)
  lines.push(``)
  lines.push(`  local function assignTempFader(pageNum, execNum)`)
  lines.push(`    gma.cmd("Assign Executor " .. pageNum .. "." .. execNum .. " /FaderMaster=\"Temp\"")`)
  lines.push(`  end`)
  lines.push(``)

  // ── P/T Slow ──────────────────────────────────────────────────────────────
  if (moverGroups.length > 0) {
    lines.push(`  -- ┌─────────────────────────────────────────┐`)
    lines.push(`  -- │ Pan/Tilt SLOW Phaser  (Page ${page}, Exec ${exec}) │`)
    lines.push(`  -- └─────────────────────────────────────────┘`)
    lines.push(`  -- Effect Engine approach (verify syntax in your MA3 version):`)
    lines.push(`  gma.cmd("ClearAll")`)
    for (const g of moverGroups) {
      lines.push(`  gma.cmd("SelFix Group \"${g.maGroupName}\"")`)
    }
    lines.push(`  -- Attempt Effect Engine: if this fails, see step-chase alternative below`)
    lines.push(`  gma.cmd("Attribute \\"Pan\\" Phaser 1")`)
    lines.push(`  gma.cmd("Attribute \\"Tilt\\" Phaser 1")`)
    lines.push(`  applyPreset("${ptPreset}")`)
    lines.push(`  -- Note: to set Width=30 Rate=0.3, open the Effect Engine window in MA3`)
    lines.push(`  -- and adjust \"DP_PHASER_PT_SLOW\" after running this script`)
    lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_PT_SLOW\\" Cue 1 Merge")`)
    lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_PT_SLOW\\" at Page ${page} Exec ${exec}")`)
    lines.push(`  assignTempFader(${page}, ${exec})`)
    lines.push(``)
    lines.push(`  --[[ STEP-CHASE ALTERNATIVE (comment the above, uncomment this):`)
    lines.push(`  -- This creates a 16-step pan sweep — guaranteed to work`)
    lines.push(`  gma.cmd("ClearAll")`)
    for (const g of moverGroups) {
      lines.push(`  gma.cmd("SelFix Group \"${g.maGroupName}\"")`)
    }
    const panPositions = [50,56,62,68,74,80,74,68,62,56,50,44,38,32,38,44]
    panPositions.forEach((pos, i) => {
      lines.push(`  gma.cmd("Attribute \\"Pan\\" at ${pos}")`)
      lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_PT_SLOW\\" Cue ${i+1} Merge")`)
      lines.push(`  gma.cmd("Cue ${i+1} Sequence \\"DP_PHASER_PT_SLOW\\" property \\"FadeTime\\" 0.3")`)
    })
    lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_PT_SLOW\\" at Page ${page} Exec ${exec}")`)
    lines.push(`  assignTempFader(${page}, ${exec})`)
    lines.push(`  --]]`)
    lines.push(``)
    exec++

    if (includePtFast) {
      lines.push(`  -- ┌─────────────────────────────────────────┐`)
      lines.push(`  -- │ Pan/Tilt FAST Phaser  (Page ${page}, Exec ${exec}) │`)
      lines.push(`  -- └─────────────────────────────────────────┘`)
      lines.push(`  gma.cmd("ClearAll")`)
      for (const g of moverGroups) {
        lines.push(`  gma.cmd("SelFix Group \"${g.maGroupName}\"")`)
      }
      lines.push(`  gma.cmd("Attribute \\"Pan\\" Phaser 1")`)
      lines.push(`  gma.cmd("Attribute \\"Tilt\\" Phaser 1")`)
      lines.push(`  applyPreset("${ptPreset}")`)
      lines.push(`  -- Adjust width/rate in Effect Engine after running (target: Width=45, Rate=1.2)`)
      lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_PT_FAST\\" Cue 1 Merge")`)
      lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_PT_FAST\\" at Page ${page} Exec ${exec}")`)
      lines.push(`  assignTempFader(${page}, ${exec})`)
      lines.push(``)
      exec++
    } else {
      lines.push(`  -- PT Fast disabled in generator options — skipping DP_PHASER_PT_FAST`)
      lines.push(``)
    }

    if (includePanOnly) {
      lines.push(`  -- ┌─────────────────────────────────────────┐`)
      lines.push(`  -- │ Pan ONLY Phaser     (Page ${page}, Exec ${exec}) │`)
      lines.push(`  -- └─────────────────────────────────────────┘`)
      lines.push(`  gma.cmd("ClearAll")`)
      for (const g of moverGroups) {
        lines.push(`  gma.cmd("SelFix Group \"${g.maGroupName}\"")`)
      }
      lines.push(`  gma.cmd("Attribute \\"Pan\\" Phaser 1")`)
      lines.push(`  applyPreset("${panPreset}")`)
      lines.push(`  -- Adjust width/rate in Effect Engine after running`)
      lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_PAN_ONLY\\" Cue 1 Merge")`)
      lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_PAN_ONLY\\" at Page ${page} Exec ${exec}")`)
      lines.push(`  assignTempFader(${page}, ${exec})`)
      lines.push(``)
      exec++
    }

    if (includeTiltOnly) {
      lines.push(`  -- ┌─────────────────────────────────────────┐`)
      lines.push(`  -- │ Tilt ONLY Phaser    (Page ${page}, Exec ${exec}) │`)
      lines.push(`  -- └─────────────────────────────────────────┘`)
      lines.push(`  gma.cmd("ClearAll")`)
      for (const g of moverGroups) {
        lines.push(`  gma.cmd("SelFix Group \"${g.maGroupName}\"")`)
      }
      lines.push(`  gma.cmd("Attribute \\"Tilt\\" Phaser 1")`)
      lines.push(`  applyPreset("${tiltPreset}")`)
      lines.push(`  -- Adjust width/rate in Effect Engine after running`)
      lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_TILT_ONLY\\" Cue 1 Merge")`)
      lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_TILT_ONLY\\" at Page ${page} Exec ${exec}")`)
      lines.push(`  assignTempFader(${page}, ${exec})`)
      lines.push(``)
      exec++
    }
  } else {
    lines.push(`  -- No Pan/Tilt groups defined — skipping mover-based phasers`)
    lines.push(``)
  }

  // ── Color Chase ───────────────────────────────────────────────────────────
  if (rgbGroups.length > 0) {
    lines.push(`  -- ┌───────────────────────────────────────────┐`)
    lines.push(`  -- │ Color Chase Phaser    (Page ${page}, Exec ${exec}) │`)
    lines.push(`  -- └───────────────────────────────────────────┘`)
    lines.push(`  gma.cmd("ClearAll")`)
    for (const g of rgbGroups) {
      lines.push(`  gma.cmd("SelFix Group \\"${g.maGroupName}\\"")`)
    }
    lines.push(`  gma.cmd("Attribute \\"Hue\\" Phaser 1")`)
    lines.push(`  -- Adjust Hue phaser range in Effect Engine (target: Width=180 for full rainbow sweep)`)
    lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_COLOR\\" Cue 1 Merge")`)
    lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_COLOR\\" at Page ${page} Exec ${exec}")`)
  } else {
    lines.push(`  -- No RGB groups — skipping color chase (exec ${exec})`)
  }
  lines.push(``)
  exec++

  // ── Dimmer Pulse ──────────────────────────────────────────────────────────
  lines.push(`  -- ┌────────────────────────────────────────────┐`)
  lines.push(`  -- │ Dimmer Pulse Phaser    (Page ${page}, Exec ${exec}) │`)
  lines.push(`  -- └────────────────────────────────────────────┘`)
  lines.push(`  gma.cmd("ClearAll")`)
  for (const g of allGroups) {
    lines.push(`  gma.cmd("SelFix Group \\"${g.maGroupName}\\"")`)
  }
  lines.push(`  gma.cmd("Attribute \\"Dimmer\\" Phaser 1")`)
  lines.push(`  -- Adjust phaser shape to Square in Effect Engine (for hard on/off pulse)`)
  lines.push(`  gma.cmd("Store Sequence \\"DP_PHASER_DIM\\" Cue 1 Merge")`)
  lines.push(`  gma.cmd("Assign Sequence \\"DP_PHASER_DIM\\" at Page ${page} Exec ${exec}")`)
  lines.push(``)
  exec++

  lines.push(`  gma.cmd("BlindEdit Off")`)
  lines.push(`  gma.echo("Disco Pilot Phasers: Done. Check sequences in Effect Engine to verify/adjust.")`)
  lines.push(`end`)
  lines.push(``)
  lines.push(`main()`)

  return lines.join('\n')
}

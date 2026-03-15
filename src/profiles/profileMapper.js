/**
 * Profile Mapper
 *
 * Translates a genre profile + live audio state → OSC actions.
 *
 * Handles:
 *   - Genre transitions (crossfade timing)
 *   - BPM rate master updates
 *   - Effect size master (energy-driven)
 *   - Phaser enable/disable per profile
 *   - Color look switching (Go+ on new sequence, fade out old)
 *   - Drop detection (energy spike after silence)
 *   - Silence holdback (don't change anything while silent)
 *   - Boundary enforcement (values clamped to calibrated min/max)
 */

import * as oscClient from '../osc/client.js'
import * as addressMap from '../osc/addressMap.js'
import { getProfile } from './genreProfiles.js'

// ── State ─────────────────────────────────────────────────────────────────────

let activeGenre = null
let activePhaseState = {}
let lastBpm = 120
let transitionTimer = null
let dropCooldown = false

// Manual override flags (set from dashboard)
let lockedGenre = null       // If set, ignore genre detection
let disabledPhasers = new Set()  // Phaser keys the operator has disabled
let manualBpm = null         // If set, use this BPM instead of detected

// Drop detection state
let energyHistory = []
const ENERGY_HISTORY_LEN = 30

// ── Public API ────────────────────────────────────────────────────────────────

export function setLockedGenre(genre) { lockedGenre = genre }
export function clearLockedGenre() { lockedGenre = null }
export function setDisabledPhaser(key, disabled) {
  if (disabled) disabledPhasers.add(key)
  else disabledPhasers.delete(key)
}
export function setManualBpm(bpm) { manualBpm = bpm }
export function clearManualBpm() { manualBpm = null }

/**
 * Called every ~100ms with live audio metrics from BPM detector.
 * Updates rate master and effect size continuously.
 */
export function onAudioFrame({ bpm, energy, isSilent }) {
  if (isSilent) return  // Hold everything during silence

  // Drop detection
  detectDrop(energy)

  const effectiveBpm = manualBpm ?? bpm

  // Update rate master (only if BPM changes significantly)
  if (Math.abs(effectiveBpm - lastBpm) > 2) {
    lastBpm = effectiveBpm
    updateBpmMaster(effectiveBpm)
  }

  // Update effect size master (energy-driven, smooth)
  updateEffectSize(energy)
}

/**
 * Called when genre detector changes the detected genre.
 * Triggers a profile switch (with transition).
 */
export function onGenreChange(newGenre) {
  const effectiveGenre = lockedGenre ?? newGenre
  if (effectiveGenre === activeGenre) return

  switchGenre(effectiveGenre)
}

/**
 * Force an immediate genre switch (from manual override).
 */
export function forceGenre(genre) {
  lockedGenre = genre
  switchGenre(genre)
}

export function getActiveGenre() { return activeGenre }
export function getLastBpm() { return lastBpm }

// ── Genre Switching ───────────────────────────────────────────────────────────

function switchGenre(genre) {
  const profile = getProfile(genre)
  const prevGenre = activeGenre
  activeGenre = genre

  // Clear any in-progress transition
  if (transitionTimer) {
    clearTimeout(transitionTimer)
    transitionTimer = null
  }

  // Switch color look: press key on new sequence
  const newLook = addressMap.getColorLookExecutor(genre)
  if (newLook) {
    oscClient.pressKey(newLook.page, newLook.exec, true)
  }

  // Fade out previous color look (after transition time)
  const prevLook = prevGenre ? addressMap.getColorLookExecutor(prevGenre) : null
  if (prevLook && prevGenre !== genre) {
    transitionTimer = setTimeout(() => {
      oscClient.pressKey(prevLook.page, prevLook.exec, false)
    }, profile.transitionTime * 1000)
  }

  // Update phasers
  updatePhasers(profile)

  // Update strobe
  updateStrobe(profile)
}

function updatePhasers(profile) {
  const phaserTypes = ['ptSlow', 'ptFast', 'colorChase', 'dimPulse']
  for (const type of phaserTypes) {
    const exec = addressMap.getPhaserExecutor(type)
    if (!exec) continue

    const shouldEnable = profile.phasers[type] && !disabledPhasers.has(type)
    const wasEnabled = activePhaseState[type]

    if (shouldEnable !== wasEnabled) {
      oscClient.pressKey(exec.page, exec.exec, shouldEnable)
      activePhaseState[type] = shouldEnable
    }
  }
}

function updateStrobe(profile) {
  // Strobe is treated as a phaser of type 'strobe' if it exists in the map
  const exec = addressMap.getPhaserExecutor('strobe')
  if (!exec) return

  if (profile.strobeEnabled && !disabledPhasers.has('strobe')) {
    const boundary = addressMap.getBoundary(exec.page, exec.exec)
    const value = profile.strobeIntensity * (boundary.max - boundary.min) + boundary.min
    oscClient.setFader(exec.page, exec.exec, value, boundary)
    oscClient.pressKey(exec.page, exec.exec, true)
  } else {
    oscClient.pressKey(exec.page, exec.exec, false)
  }
}

// ── Masters ───────────────────────────────────────────────────────────────────

function updateBpmMaster(bpm) {
  const exec = addressMap.getMasterExecutor('bpmRate')
  if (!exec) return

  // MA3 Rate master: send BPM as a command
  oscClient.sendCmd(`Rate ${bpm} Executor ${exec.page}.${exec.exec}`)
}

function updateEffectSize(energy) {
  const exec = addressMap.getMasterExecutor('effectSize')
  if (!exec) return

  const profile = getProfile(activeGenre || 'unknown')
  // Scale energy to profile's target effect size
  const targetSize = profile.effectSize
  // Energy typically 0–0.3 for normal music, normalize against a reference
  const energyNorm = Math.min(energy / 0.15, 1.0)
  // Blend profile target with live energy
  const value = targetSize * 0.6 + energyNorm * targetSize * 0.4

  const boundary = addressMap.getBoundary(exec.page, exec.exec)
  oscClient.setFader(exec.page, exec.exec, value, boundary)
}

// ── Drop Detection ────────────────────────────────────────────────────────────

function detectDrop(energy) {
  energyHistory.push(energy)
  if (energyHistory.length > ENERGY_HISTORY_LEN) energyHistory.shift()

  if (dropCooldown || energyHistory.length < ENERGY_HISTORY_LEN) return

  const recent = energyHistory.slice(-5)
  const earlier = energyHistory.slice(0, 10)
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
  const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length

  // Drop = energy was low, then suddenly high
  if (earlierAvg < 0.04 && recentAvg > earlierAvg * 3 && recentAvg > 0.08) {
    triggerDrop()
    dropCooldown = true
    setTimeout(() => { dropCooldown = false }, 10000)  // 10s cooldown
  }
}

function triggerDrop() {
  // On a drop: briefly boost effect size to max, then return
  const exec = addressMap.getMasterExecutor('effectSize')
  if (!exec) return

  const boundary = addressMap.getBoundary(exec.page, exec.exec)
  oscClient.setFader(exec.page, exec.exec, boundary.max, boundary)

  setTimeout(() => {
    // Return to profile-driven level after 4 beats worth of time
    updateEffectSize(0.1)
  }, (60 / lastBpm) * 4 * 1000)
}

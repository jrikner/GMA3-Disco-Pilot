const BASELINE_WINDOW_SIZE = 32
const BASELINE_ALPHA = 0.06
const BASELINE_ALPHA_ARMED = 0.02
const RECENT_ENERGY_ALPHA = 0.55
const MIN_STDDEV = 0.003
const MIN_BASELINE_FRAMES = 12

const PRE_DROP_DIP_RATIO = 0.74
const PRE_DROP_LOW_DIP_RATIO = 1.0
const PRE_DROP_DIP_FRAMES = 3
const BEAT_LOCK_USABLE = 0.3
const BEAT_LOCK_MODERATE = 0.3
const BEAT_LOCK_STRONG = 0.55

const PRIMARY_ENERGY_ZSCORE = 1.8
const PRIMARY_ENERGY_RATIO = 1.35
const PRIMARY_LOW_RATIO = 1.45

const BRIDGE_ENERGY_ZSCORE = 0.75
const BRIDGE_ENERGY_RATIO = 1.4
const BRIDGE_LOW_RATIO = 1.45
const BRIDGE_ONSET_THRESHOLD_MULTIPLIER = 1.05

const FALLBACK_ENERGY_RATIO = 1.75
const FALLBACK_LOW_RATIO = 1.6
const FALLBACK_ONSET_THRESHOLD_MULTIPLIER = 1.1
const FALLBACK_CONFIRM_FRAMES = 2
const ONSET_GRACE_MS = 180

const COOLDOWN_BEATS = 16
const COOLDOWN_MIN_MS = 4500
const COOLDOWN_MAX_MS = 12000
const ARM_WINDOW_BEATS = 2.4
const ARM_WINDOW_MIN_MS = 750
const ARM_WINDOW_MAX_MS = 2600

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function pushFixedWindow(values, value, limit) {
  values.push(value)
  if (values.length > limit) values.shift()
}

function computeStats(values) {
  if (!values.length) {
    return { mean: 0, stddev: MIN_STDDEV }
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + ((v - mean) ** 2), 0) / values.length
  const stddev = Math.max(MIN_STDDEV, Math.sqrt(Math.max(variance, 0)))
  return { mean, stddev }
}

function sanitizePositive(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, value)
}

export function createDropDetector(options = {}) {
  const opts = {
    baselineWindowSize: options.baselineWindowSize ?? BASELINE_WINDOW_SIZE,
  }

  let initialized = false
  let energyBaseline = 0
  let lowBaseline = 0
  let recentEnergy = 0
  let recentLowBand = 0
  let energyWindow = []
  let lowWindow = []

  let preDropDipFrames = 0
  let armed = false
  let armedAtMs = 0
  let lastOnsetMs = -Infinity
  let fallbackConfirmFrames = 0
  let cooldownUntilMs = 0

  function reset() {
    initialized = false
    energyBaseline = 0
    lowBaseline = 0
    recentEnergy = 0
    recentLowBand = 0
    energyWindow = []
    lowWindow = []
    preDropDipFrames = 0
    armed = false
    armedAtMs = 0
    lastOnsetMs = -Infinity
    fallbackConfirmFrames = 0
    cooldownUntilMs = 0
  }

  function trigger(nowMs, bpm, path) {
    const safeBpm = clamp(Number.isFinite(bpm) ? bpm : 120, 60, 200)
    const cooldownMs = clamp((60 / safeBpm) * COOLDOWN_BEATS * 1000, COOLDOWN_MIN_MS, COOLDOWN_MAX_MS)
    cooldownUntilMs = nowMs + cooldownMs
    preDropDipFrames = 0
    fallbackConfirmFrames = 0
    armed = false
    armedAtMs = 0

    return {
      triggered: true,
      path,
      cooldownMs,
    }
  }

  function update(frame = {}) {
    const nowMs = Number.isFinite(frame.nowMs) ? frame.nowMs : Date.now()
    const bpm = clamp(Number.isFinite(frame.bpm) ? frame.bpm : 120, 60, 200)
    const energy = sanitizePositive(frame.energy)
    const lowBandEnergy = sanitizePositive(frame.lowBandEnergy)
    const beatLockStrength = sanitizePositive(frame.beatLockStrength)
    const onsetStrength = sanitizePositive(frame.onsetStrength)
    const onsetThreshold = sanitizePositive(frame.onsetThreshold)
    const isOnset = Boolean(frame.isOnset)
    const tempoLocked = Boolean(frame.tempoLocked)
    if (isOnset) {
      lastOnsetMs = nowMs
    }

    if (!initialized) {
      initialized = true
      energyBaseline = energy
      lowBaseline = lowBandEnergy
      recentEnergy = energy
      recentLowBand = lowBandEnergy
    }

    pushFixedWindow(energyWindow, energy, opts.baselineWindowSize)
    pushFixedWindow(lowWindow, lowBandEnergy, opts.baselineWindowSize)

    const alpha = armed ? BASELINE_ALPHA_ARMED : BASELINE_ALPHA
    energyBaseline = energyBaseline * (1 - alpha) + energy * alpha
    lowBaseline = lowBaseline * (1 - alpha) + lowBandEnergy * alpha
    recentEnergy = recentEnergy * (1 - RECENT_ENERGY_ALPHA) + energy * RECENT_ENERGY_ALPHA
    recentLowBand = recentLowBand * (1 - RECENT_ENERGY_ALPHA) + lowBandEnergy * RECENT_ENERGY_ALPHA

    const energyStats = computeStats(energyWindow)
    const energyZScore = (energy - energyStats.mean) / energyStats.stddev

    const hasPreDropDip = recentEnergy < energyBaseline * PRE_DROP_DIP_RATIO
      && recentLowBand < lowBaseline * PRE_DROP_LOW_DIP_RATIO

    if (hasPreDropDip) {
      preDropDipFrames++
      if (armed) {
        // Keep the arming window anchored to the active dip so the post-dip
        // onset still gets a full 2-beat trigger window.
        armedAtMs = nowMs
      }
    } else {
      preDropDipFrames = 0
    }

    if (!armed && preDropDipFrames >= PRE_DROP_DIP_FRAMES) {
      armed = true
      armedAtMs = nowMs
      fallbackConfirmFrames = 0
    }

    if (energyWindow.length < MIN_BASELINE_FRAMES || lowWindow.length < MIN_BASELINE_FRAMES) {
      return {
        triggered: false,
        armed,
        coolingDown: false,
        warmingUp: true,
      }
    }

    if (armed) {
      const armWindowMs = clamp((60 / bpm) * ARM_WINDOW_BEATS * 1000, ARM_WINDOW_MIN_MS, ARM_WINDOW_MAX_MS)
      if ((nowMs - armedAtMs) > armWindowMs) {
        armed = false
        preDropDipFrames = 0
        fallbackConfirmFrames = 0
      }
    }

    if (cooldownUntilMs > nowMs) {
      return {
        triggered: false,
        armed,
        coolingDown: true,
        cooldownRemainingMs: cooldownUntilMs - nowMs,
      }
    }

    const onsetOrRecent = isOnset
      || (Number.isFinite(lastOnsetMs) && lastOnsetMs > 0 && (nowMs - lastOnsetMs) <= ONSET_GRACE_MS)

    const primaryReady = armed
      && beatLockStrength >= BEAT_LOCK_STRONG
      && onsetOrRecent
      && energyZScore >= PRIMARY_ENERGY_ZSCORE
      && energy > energyBaseline * PRIMARY_ENERGY_RATIO
      && lowBandEnergy > lowBaseline * PRIMARY_LOW_RATIO

    if (primaryReady) {
      return trigger(nowMs, bpm, 'primary')
    }

    const bridgeOnsetGate = onsetStrength > Math.max(
      onsetThreshold * BRIDGE_ONSET_THRESHOLD_MULTIPLIER,
      onsetThreshold + 0.0003,
    )
    const bridgeReady = armed
      && onsetOrRecent
      && bridgeOnsetGate
      && beatLockStrength >= BEAT_LOCK_MODERATE
      && beatLockStrength < BEAT_LOCK_STRONG
      && energyZScore >= BRIDGE_ENERGY_ZSCORE
      && energy > energyBaseline * BRIDGE_ENERGY_RATIO
      && lowBandEnergy > lowBaseline * BRIDGE_LOW_RATIO

    if (bridgeReady) {
      return trigger(nowMs, bpm, 'bridge')
    }

    const fallbackOnsetGate = onsetStrength > Math.max(
      onsetThreshold * FALLBACK_ONSET_THRESHOLD_MULTIPLIER,
      onsetThreshold + 0.0004,
    )
    const fallbackFramePasses = armed
      && beatLockStrength < BEAT_LOCK_USABLE
      && fallbackOnsetGate
      && energy > energyBaseline * FALLBACK_ENERGY_RATIO
      && lowBandEnergy > lowBaseline * FALLBACK_LOW_RATIO

    if (fallbackFramePasses) {
      fallbackConfirmFrames++
    } else {
      fallbackConfirmFrames = 0
    }

    if (fallbackConfirmFrames >= FALLBACK_CONFIRM_FRAMES) {
      return trigger(nowMs, bpm, 'fallback')
    }

    return {
      triggered: false,
      armed,
      coolingDown: false,
      energyBaseline,
      lowBaseline,
      energyZScore,
    }
  }

  return {
    update,
    reset,
    _debugState() {
      return {
        initialized,
        armed,
        preDropDipFrames,
        fallbackConfirmFrames,
        cooldownUntilMs,
        energyBaseline,
        lowBaseline,
        recentEnergy,
        recentLowBand,
        energyWindowSize: energyWindow.length,
      }
    },
  }
}

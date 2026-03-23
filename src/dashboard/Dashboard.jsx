/**
 * Main live operator dashboard.
 *
 * Panels:
 *   - Genre Display (col 1, row 2)
 *   - Audio Monitor / BPM (col 2, row 2)
 *   - Active Profile params (col 3, row 2)
 *   - Manual Overrides / Context editor (col 1, row 3)
 *   - Genre selector / lock (col 2, row 3)
 *   - Phaser toggles + Panic presets (col 3, row 3)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import useStore from '../store/appState.js'
import { startCapture, stopCapture, listAudioDevices, getInputGain, setInputGain as applyInputGain } from '../audio/capture.js'
import { startBPMDetector, stopBPMDetector } from '../audio/bpmDetector.js'
import { initGenreDetector, startGenreDetector, stopGenreDetector, setContextWeights, setGenreRealtimeHint, getGenreDetectorStatus } from '../audio/genreDetector.js'
import * as profileMapper from '../profiles/profileMapper.js'
import { getProfile, ALL_GENRES, TONIGHT_CONTEXTS } from '../profiles/genreProfiles.js'
import * as oscClient from '../osc/client.js'
import { getAppAssetUrl } from '../utils/appAssetUrl.js'
import styles from './Dashboard.module.css'

const MIN_INPUT_GAIN = 0.25
const MAX_INPUT_GAIN = 8
const AUTO_GAIN_CHECK_INTERVAL_MS = 60000
const AUTO_GAIN_MEASUREMENT_WINDOW_MS = 10000
const AUTO_GAIN_SILENT_RMS_THRESHOLD = 0.005
const AUTO_GAIN_QUIET_RMS_MAX = 0.02
const AUTO_GAIN_TARGET_RMS = 0.035
const AUTO_GAIN_MIN_RMS_FOR_TARGET = 0.006
const AUTO_GAIN_LOUD_CLIP_RATIO_AVG = 0.002
const AUTO_GAIN_LOUD_PEAK_P95 = 0.92
const AUTO_GAIN_LOUD_RMS_P95 = 0.1
const AUTO_GAIN_MAX_BOOST = 2
const AUTO_GAIN_TARGET_GAIN_DEFAULT = 1.6
const DROP_CALIBRATION_AUDIO_PATH = getAppAssetUrl('test-audio/bpm125-drop-validation.wav')
const DROP_CALIBRATION_EXPECTED_CUES_SEC = [12, 28, 44]
const DROP_CALIBRATION_TIMEOUT_MS = 70000
const DROP_CALIBRATION_MAX_REASONABLE_MS = 5000
const DROP_CALIBRATION_START_DELAY_MS = 1500
const DROP_CALIBRATION_CUE_PRE_ROLL_SEC = 4
const DROP_CALIBRATION_CUE_POST_ROLL_SEC = 2
const AUTO_MIC_RETRY_MS = 2500
const BPM_HARMONIC_MULTIPLIERS = [0.5, 2 / 3, 0.75, 1, 4 / 3, 1.5, 2]
const BPM_GENRE_MAX_STEP_PER_FRAME = 2
const EDM_TECHNO_DISAMBIGUATION_MIN_BPM = 126
const EDM_TECHNO_DISAMBIGUATION_MAX_BPM = 122
const EDM_TECHNO_SCORE_RATIO_THRESHOLD = 0.72
const EDM_TECHNO_REMAP_TO_TECHNO_BPM = 127
const EDM_TECHNO_REMAP_TO_EDM_BPM = 124
const EDM_TECHNO_REMAP_STABLE_FRAMES = 20
const GENRE_FALLBACK_MIN_STABLE_FRAMES = 18
const BPM_GENRE_RANGES = {
  edm: [110, 145],
  techno: [118, 155],
  hiphop: [70, 105],
  pop: [90, 140],
  eighties: [90, 135],
  latin: [85, 135],
  rock: [85, 155],
  corporate: [70, 130],
  unknown: [60, 200],
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function mean(values) {
  if (!values.length) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

function percentile(values, ratio) {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function meanAbsolute(values) {
  if (!values.length) return 0
  return values.reduce((total, value) => total + Math.abs(value), 0) / values.length
}

function normalizeBpmByGenre(rawBpm, genre, previousBpm = null) {
  if (!Number.isFinite(rawBpm)) return rawBpm

  const [min, max] = BPM_GENRE_RANGES[genre] || BPM_GENRE_RANGES.unknown
  const candidates = BPM_HARMONIC_MULTIPLIERS
    .map((multiplier) => rawBpm * multiplier)
    .filter((value) => value >= 60 && value <= 200)

  const inRange = candidates.filter((value) => value >= min && value <= max)
  const pool = inRange.length ? inRange : candidates
  const target = Number.isFinite(previousBpm) ? previousBpm : rawBpm

  let best = pool[0] ?? rawBpm
  let bestDelta = Math.abs(best - target)
  for (let i = 1; i < pool.length; i++) {
    const candidate = pool[i]
    const delta = Math.abs(candidate - target)
    if (delta < bestDelta) {
      best = candidate
      bestDelta = delta
    }
  }

  if (!inRange.length) {
    best = clamp(best, min, max)
  }

  if (Number.isFinite(previousBpm)) {
    const delta = best - previousBpm
    const boundedDelta = clamp(delta, -BPM_GENRE_MAX_STEP_PER_FRAME, BPM_GENRE_MAX_STEP_PER_FRAME)
    best = previousBpm + boundedDelta
  }

  return Math.round(best)
}

function resolveAmbiguousGenre(result, bpmHint, previousGenre = null) {
  const selectedGenre = result?.genre || 'unknown'
  const entries = Array.isArray(result?.topGenres) ? result.topGenres : []
  const scoreFor = (genre) => {
    const entry = entries.find((item) => item?.genre === genre)
    if (!entry) return 0
    if (Number.isFinite(entry.weighted)) return entry.weighted
    if (Number.isFinite(entry.raw)) return entry.raw
    return 0
  }

  if (!Number.isFinite(bpmHint)) {
    return selectedGenre
  }

  const edmScore = scoreFor('edm')
  const technoScore = scoreFor('techno')
  const technoCloseEnough = technoScore > 0 && technoScore >= (edmScore * EDM_TECHNO_SCORE_RATIO_THRESHOLD)
  const edmCloseEnough = edmScore > 0 && edmScore >= (technoScore * EDM_TECHNO_SCORE_RATIO_THRESHOLD)

  if (
    selectedGenre === 'edm'
    && bpmHint >= EDM_TECHNO_DISAMBIGUATION_MIN_BPM
    && (technoCloseEnough || (previousGenre === 'techno' && technoScore > 0))
  ) {
    return 'techno'
  }

  if (
    selectedGenre === 'techno'
    && bpmHint <= EDM_TECHNO_DISAMBIGUATION_MAX_BPM
    && edmCloseEnough
  ) {
    return 'edm'
  }

  return selectedGenre
}

function inferFallbackGenreFromBpm(bpm) {
  if (!Number.isFinite(bpm)) return 'unknown'
  if (bpm >= 126) return 'techno'
  if (bpm >= 108 && bpm < 126) return 'edm'
  if (bpm >= 72 && bpm <= 102) return 'hiphop'
  return 'unknown'
}

function inferEdmTechnoRemapGenre(currentGenre, bpm) {
  if (!Number.isFinite(bpm)) return currentGenre
  if (currentGenre === 'edm' && bpm >= EDM_TECHNO_REMAP_TO_TECHNO_BPM) return 'techno'
  if (currentGenre === 'techno' && bpm <= EDM_TECHNO_REMAP_TO_EDM_BPM) return 'edm'
  return currentGenre
}

const PHASER_DEFS = [
  { key: 'ptSlow',     label: 'P/T Circle' },
  { key: 'panOnly',    label: 'Pan-only' },
  { key: 'tiltOnly',   label: 'Tilt-only' },
  { key: 'colorChase', label: 'Color Chase' },
  { key: 'dimPulse',   label: 'Dimmer Pulse' },
]

const genreColors = {
  techno: '#60a5fa', edm: '#a78bfa', hiphop: '#f59e0b',
  pop: '#f472b6', eighties: '#fb923c', latin: '#4ade80',
  rock: '#ef4444', corporate: '#94a3b8', unknown: '#555',
}

export default function Dashboard() {
  const {
    live, updateLive, osc, updateOsc,
    overrides, setLockedGenre, clearLockedGenre,
    setManualBpm, clearManualBpm, togglePhaser, setBlackout, setKillStrobe, setHoldFreeze,
    setScreen, session, updateSession,
    audioDeviceId, setAudioDeviceId,
    inputGain, setInputGain,
    autoInputGain, setAutoInputGain,
    appendHistory, history,
    panicConfig,
  } = useStore()

  const genreProcessorRef = useRef(null)
  const [tapTimes, setTapTimes] = useState([])
  const [isStarting, setIsStarting] = useState(false)
  const [audioDevices, setAudioDevices] = useState([])

  // Drop flash
  const [dropFlash, setDropFlash] = useState(false)

  // Genre transition flash
  const [genreFlash, setGenreFlash] = useState(false)
  const prevGenreRef = useRef(live.genre)

  // OSC receive
  const [lastOscReceived, setLastOscReceived] = useState(null)
  const [oscSendFlash, setOscSendFlash] = useState(false)

  // Tonight's context editor visibility
  const [showContextEditor, setShowContextEditor] = useState(false)
  const [liveContexts, setLiveContexts] = useState(session.tonightContexts || [])

  // History panel visibility
  const [showHistory, setShowHistory] = useState(false)

  // Panic: house default page/exec inputs
  const [showPanicConfig, setShowPanicConfig] = useState(false)
  const [autoGainStatus, setAutoGainStatus] = useState('')
  const [dropCalibrationStatus, setDropCalibrationStatus] = useState('')
  const [dropSessionOffsetMs, setDropSessionOffsetMs] = useState(null)
  const [dropCalibrationRunning, setDropCalibrationRunning] = useState(false)
  const holdFreezeRef = useRef(overrides.holdFreeze)
  const gainSyncImmediateRef = useRef(true)
  const autoGainLoopIntervalRef = useRef(null)
  const autoGainMeasurementTimeoutRef = useRef(null)
  const autoGainCollectingRef = useRef(false)
  const autoGainSamplesRef = useRef([])
  const autoGainTargetRef = useRef(AUTO_GAIN_TARGET_GAIN_DEFAULT)
  const dropCalibrationRanRef = useRef(false)
  const dropCalibrationResolvedRef = useRef(false)
  const dropSessionOffsetRef = useRef(0)
  const audioStartTokenRef = useRef(0)
  const startInFlightRef = useRef(false)
  const shouldAutoStartRef = useRef(true)
  const autoStartRetryTimeoutRef = useRef(null)
  const dropCalibrationRunningRef = useRef(false)
  const dropCalibrationGateRef = useRef(null)
  const lockedGenreRef = useRef(overrides.lockedGenre)
  const genreAdjustedBpmRef = useRef(null)
  const fallbackGenreCandidateRef = useRef({ genre: null, count: 0 })
  const edmTechnoRemapCandidateRef = useRef({ genre: null, count: 0 })

  // ── Start / Stop capture ──────────────────────────────────────────────────

  useEffect(() => {
    loadAudioDevices()
  }, [])

  useEffect(() => {
    profileMapper.setDropTimingOffset(0)
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onMicrophonePermission) return undefined

    return window.electronAPI.onMicrophonePermission(({ granted, error }) => {
      updateLive({ audioError: granted ? null : error || 'Microphone access was denied.' })
    })
  }, [updateLive])

  async function loadAudioDevices() {
    try {
      // Request permission first so labels are available
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()))
      const devs = await listAudioDevices()
      setAudioDevices(devs)
      updateLive({ audioError: null })
    } catch (err) {
      updateLive({ audioError: err?.message || 'Microphone access is unavailable.' })
    }
  }

  function clearAutoStartRetry() {
    if (autoStartRetryTimeoutRef.current) {
      window.clearTimeout(autoStartRetryTimeoutRef.current)
      autoStartRetryTimeoutRef.current = null
    }
  }

  function scheduleAutoStartRetry(deviceId = audioDeviceId) {
    if (!shouldAutoStartRef.current) return
    const currentlyCapturing = useStore.getState().live?.isCapturing
    if (currentlyCapturing || startInFlightRef.current) return
    if (autoStartRetryTimeoutRef.current) return

    autoStartRetryTimeoutRef.current = window.setTimeout(() => {
      autoStartRetryTimeoutRef.current = null
      const capturingNow = useStore.getState().live?.isCapturing
      if (!shouldAutoStartRef.current || capturingNow || startInFlightRef.current) return
      startAudio(deviceId)
    }, AUTO_MIC_RETRY_MS)
  }

  useEffect(() => {
    shouldAutoStartRef.current = true
    startAudio()
    return () => {
      shouldAutoStartRef.current = false
      clearAutoStartRetry()
      stopAudio()
    }
  }, [])

  useEffect(() => {
    if (!shouldAutoStartRef.current) return
    if (live.isCapturing || startInFlightRef.current) return
    scheduleAutoStartRetry(audioDeviceId)
  }, [audioDeviceId, live.isCapturing])

  useEffect(() => {
    const immediate = gainSyncImmediateRef.current
    applyInputGain(inputGain, { immediate })
    gainSyncImmediateRef.current = true
  }, [inputGain])

  useEffect(() => {
    holdFreezeRef.current = overrides.holdFreeze
  }, [overrides.holdFreeze])

  useEffect(() => {
    lockedGenreRef.current = overrides.lockedGenre
  }, [overrides.lockedGenre])

  useEffect(() => {
    dropCalibrationRunningRef.current = dropCalibrationRunning
  }, [dropCalibrationRunning])

  const shouldSuppressInputForCalibration = useCallback((nowMs = Date.now()) => {
    if (!dropCalibrationRunningRef.current) return false

    const gate = dropCalibrationGateRef.current
    if (!gate || !Number.isFinite(gate.playbackStartMs)) {
      return true
    }

    const elapsedSec = (nowMs - gate.playbackStartMs) / 1000
    const cuesSec = Array.isArray(gate.cuesSec) && gate.cuesSec.length
      ? gate.cuesSec
      : DROP_CALIBRATION_EXPECTED_CUES_SEC
    const preRollSec = Number.isFinite(gate.preRollSec)
      ? gate.preRollSec
      : DROP_CALIBRATION_CUE_PRE_ROLL_SEC
    const postRollSec = Number.isFinite(gate.postRollSec)
      ? gate.postRollSec
      : DROP_CALIBRATION_CUE_POST_ROLL_SEC

    const inCueWindow = cuesSec.some(
      (cueSec) => elapsedSec >= cueSec - preRollSec && elapsedSec <= cueSec + postRollSec,
    )
    return !inCueWindow
  }, [])

  const setDashboardInputGain = useCallback((
    value,
    { immediate = true, trackAsAutoTarget = false } = {},
  ) => {
    const clampedGain = clamp(value, MIN_INPUT_GAIN, MAX_INPUT_GAIN)
    if (trackAsAutoTarget) {
      autoGainTargetRef.current = clampedGain
    }
    gainSyncImmediateRef.current = immediate
    setInputGain(clampedGain)
    return clampedGain
  }, [setInputGain])

  const stopAutoGainMeasurement = useCallback(() => {
    if (autoGainMeasurementTimeoutRef.current) {
      window.clearTimeout(autoGainMeasurementTimeoutRef.current)
      autoGainMeasurementTimeoutRef.current = null
    }
    autoGainCollectingRef.current = false
    autoGainSamplesRef.current = []
  }, [])

  const stopAutoGainLoop = useCallback(() => {
    if (autoGainLoopIntervalRef.current) {
      window.clearInterval(autoGainLoopIntervalRef.current)
      autoGainLoopIntervalRef.current = null
    }
    stopAutoGainMeasurement()
  }, [stopAutoGainMeasurement])

  const runAutoGainMeasurement = useCallback(() => {
    stopAutoGainMeasurement()
    autoGainCollectingRef.current = true
    autoGainSamplesRef.current = []

    autoGainMeasurementTimeoutRef.current = window.setTimeout(() => {
      autoGainMeasurementTimeoutRef.current = null
      autoGainCollectingRef.current = false

      const samples = autoGainSamplesRef.current.slice()
      autoGainSamplesRef.current = []
      if (!samples.length) return

      const rmsValues = samples
        .map(sample => sample.rms)
        .filter((value) => Number.isFinite(value))
      if (!rmsValues.length) return

      const timestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      const meanRms = mean(rmsValues)

      if (meanRms < AUTO_GAIN_SILENT_RMS_THRESHOLD) {
        setAutoGainStatus(`${timestamp} Auto gain: pause detected, no change`)
        return
      }

      const clipRatios = samples
        .map(sample => sample.clipRatio)
        .filter((value) => Number.isFinite(value))
      const peakValues = samples
        .map(sample => sample.peakAbs)
        .filter((value) => Number.isFinite(value))

      const avgClipRatio = mean(clipRatios)
      const p95PeakAbs = percentile(peakValues, 0.95)
      const p95Rms = percentile(rmsValues, 0.95)

      if (
        avgClipRatio >= AUTO_GAIN_LOUD_CLIP_RATIO_AVG
        || (p95PeakAbs >= AUTO_GAIN_LOUD_PEAK_P95 && p95Rms >= AUTO_GAIN_LOUD_RMS_P95)
      ) {
        const resetGain = clamp(
          autoGainTargetRef.current,
          MIN_INPUT_GAIN,
          AUTO_GAIN_MAX_BOOST,
        )
        setDashboardInputGain(resetGain, { immediate: false })
        setAutoGainStatus(`${timestamp} Auto gain: loud input, reset to target ${resetGain.toFixed(2)}x`)
        return
      }

      if (meanRms < AUTO_GAIN_QUIET_RMS_MAX) {
        const currentGain = getInputGain()
        const targetGain = clamp(
          currentGain * (AUTO_GAIN_TARGET_RMS / Math.max(meanRms, AUTO_GAIN_MIN_RMS_FOR_TARGET)),
          MIN_INPUT_GAIN,
          AUTO_GAIN_MAX_BOOST,
        )

        if (targetGain > currentGain + 0.01) {
          setDashboardInputGain(targetGain, { immediate: false })
          setAutoGainStatus(`${timestamp} Auto gain: raised to ${targetGain.toFixed(2)}x`)
        } else {
          setAutoGainStatus(`${timestamp} Auto gain: quiet input, already near target`)
        }
        return
      }

      setAutoGainStatus(`${timestamp} Auto gain: level healthy, no change`)
    }, AUTO_GAIN_MEASUREMENT_WINDOW_MS)
  }, [setDashboardInputGain, stopAutoGainMeasurement])

  useEffect(() => {
    if (!live.isCapturing || !autoInputGain) {
      stopAutoGainLoop()
      return undefined
    }

    stopAutoGainLoop()
    autoGainLoopIntervalRef.current = window.setInterval(
      runAutoGainMeasurement,
      AUTO_GAIN_CHECK_INTERVAL_MS,
    )

    return () => stopAutoGainLoop()
  }, [autoInputGain, live.isCapturing, runAutoGainMeasurement, stopAutoGainLoop])

  const enableBestEffortDrops = useCallback((reason, { clearOffset = false } = {}) => {
    if (clearOffset) {
      dropSessionOffsetRef.current = 0
      setDropSessionOffsetMs(null)
      profileMapper.setDropTimingOffset(0)
    } else {
      profileMapper.setDropTimingOffset(dropSessionOffsetRef.current)
    }
    profileMapper.setDropTriggerSuppressed(false)
    profileMapper.setDropDetectionEnabled(true)
    dropCalibrationResolvedRef.current = true

    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    setDropCalibrationStatus(
      `${timestamp} Drop calibration unavailable (${reason}) — best effort mode active`,
    )
  }, [])

  const runDropCalibration = useCallback(async ({ auto = false, strict = false } = {}) => {
    if (dropCalibrationRunning) return
    if (!live.isCapturing) {
      if (strict) {
        enableBestEffortDrops('audio not running', { clearOffset: true })
      } else {
        setDropCalibrationStatus('Drop calibration unavailable: audio is not running')
      }
      return
    }

    const selectedDevice = audioDevices.find((d) => d.deviceId === (audioDeviceId || 'default'))
      || audioDevices.find((d) => d.deviceId === 'default')
    const selectedLabel = (selectedDevice?.label || '').toLowerCase()
    if (auto && selectedLabel && !selectedLabel.includes('blackhole')) {
      if (strict) {
        enableBestEffortDrops('BlackHole not selected', { clearOffset: true })
      } else {
        setDropCalibrationStatus('Drop calibration skipped: route input through BlackHole to auto-calibrate')
      }
      return
    }

    dropCalibrationRunningRef.current = true
    setDropCalibrationRunning(true)
    dropCalibrationGateRef.current = {
      playbackStartMs: null,
      cuesSec: DROP_CALIBRATION_EXPECTED_CUES_SEC.slice(),
      preRollSec: DROP_CALIBRATION_CUE_PRE_ROLL_SEC,
      postRollSec: DROP_CALIBRATION_CUE_POST_ROLL_SEC,
    }
    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    setDropCalibrationStatus(`${timestamp} Drop calibration${strict ? ' (strict)' : ''}: running…`)

    const previousLockedGenre = overrides.lockedGenre
    let calibrationAudio = null
    try {
      try {
        const probe = await fetch(`${DROP_CALIBRATION_AUDIO_PATH}?probe=${Date.now()}`, { method: 'HEAD' })
        const contentType = probe.headers.get('content-type')?.toLowerCase() || ''
        if (!probe.ok || !contentType.startsWith('audio/')) {
          throw new Error('Calibration reference audio is unavailable')
        }
      } catch {
        // Best-effort probe only; playback below is the source of truth.
      }

      globalThis.__DISCO_DROP_DEBUG__ = []
      profileMapper.setDropDetectionEnabled(true)
      profileMapper.setDropTriggerSuppressed(true)

      setLockedGenre('edm')
      await new Promise((resolve) => window.setTimeout(resolve, 250))

      calibrationAudio = new Audio(`${DROP_CALIBRATION_AUDIO_PATH}?cal=${Date.now()}`)
      calibrationAudio.preload = 'auto'

      let playbackStartMs = null
      const playbackDone = new Promise((resolve, reject) => {
        let finished = false
        const finish = (fn, value) => {
          if (finished) return
          finished = true
          calibrationAudio.onended = null
          calibrationAudio.onerror = null
          fn(value)
        }
        const timeout = window.setTimeout(() => {
          calibrationAudio.pause()
          finish(reject, new Error('Calibration playback timed out'))
        }, DROP_CALIBRATION_TIMEOUT_MS)
        calibrationAudio.onended = () => {
          window.clearTimeout(timeout)
          finish(resolve)
        }
        calibrationAudio.onerror = () => {
          window.clearTimeout(timeout)
          finish(reject, new Error('Calibration playback failed'))
        }
      })

      await calibrationAudio.play()
      playbackStartMs = Date.now()
      dropCalibrationGateRef.current = {
        ...(dropCalibrationGateRef.current || {}),
        playbackStartMs,
      }
      await playbackDone
      await new Promise((resolve) => window.setTimeout(resolve, 450))

      const debugRows = Array.isArray(globalThis.__DISCO_DROP_DEBUG__) ? globalThis.__DISCO_DROP_DEBUG__ : []
      const triggerSec = debugRows
        .filter((row) => row?.triggered && Number.isFinite(row.nowMs))
        .map((row) => (row.nowMs - playbackStartMs) / 1000)
        .sort((a, b) => a - b)

      const offsetsMs = []
      let cursor = 0
      for (const cueSec of DROP_CALIBRATION_EXPECTED_CUES_SEC) {
        while (cursor < triggerSec.length && triggerSec[cursor] < cueSec - 1.5) {
          cursor++
        }
        if (cursor >= triggerSec.length) break
        const hit = triggerSec[cursor]
        if (Math.abs(hit - cueSec) <= 2.5) {
          offsetsMs.push((hit - cueSec) * 1000)
          cursor++
        }
      }

      if (offsetsMs.length < 2) {
        throw new Error(`Not enough calibration hits (${offsetsMs.length}/${DROP_CALIBRATION_EXPECTED_CUES_SEC.length})`)
      }

      const avgOffsetMs = Math.round(mean(offsetsMs))
      const absMeanMs = Math.round(meanAbsolute(offsetsMs))

      if (Math.abs(avgOffsetMs) > DROP_CALIBRATION_MAX_REASONABLE_MS) {
        throw new Error(`Offset ${avgOffsetMs}ms is out of expected range`)
      }

      dropSessionOffsetRef.current = avgOffsetMs
      setDropSessionOffsetMs(avgOffsetMs)
      profileMapper.setDropTimingOffset(avgOffsetMs)
      profileMapper.setDropTriggerSuppressed(false)
      profileMapper.setDropDetectionEnabled(true)
      dropCalibrationResolvedRef.current = true

      const sign = avgOffsetMs >= 0 ? '+' : ''
      const doneTimestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      setDropCalibrationStatus(
        `${doneTimestamp} Drop calibration: ${sign}${avgOffsetMs}ms ` +
        `(mean |error| ${absMeanMs}ms, ${offsetsMs.length}/${DROP_CALIBRATION_EXPECTED_CUES_SEC.length} cues)`,
      )
    } catch (err) {
      if (strict) {
        enableBestEffortDrops(err?.message || 'strict calibration failed', { clearOffset: true })
      } else {
        const failTimestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
        setDropCalibrationStatus(`${failTimestamp} Drop calibration failed: ${err?.message || 'Unknown error'}`)
      }
    } finally {
      if (calibrationAudio) {
        calibrationAudio.pause()
      }
      dropCalibrationGateRef.current = null
      profileMapper.setDropTriggerSuppressed(false)
      if (previousLockedGenre) {
        setLockedGenre(previousLockedGenre)
      } else {
        clearLockedGenre()
      }
      dropCalibrationRunningRef.current = false
      setDropCalibrationRunning(false)
    }
  }, [
    audioDeviceId,
    audioDevices,
    clearLockedGenre,
    dropCalibrationRunning,
    enableBestEffortDrops,
    live.isCapturing,
    overrides.lockedGenre,
    setLockedGenre,
  ])

  useEffect(() => {
    if (!live.isCapturing) return undefined
    if (dropCalibrationRanRef.current) return undefined

    dropCalibrationRanRef.current = true
    dropCalibrationResolvedRef.current = false
    profileMapper.setDropDetectionEnabled(false)
    profileMapper.setDropTriggerSuppressed(false)

    const pendingTimestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    setDropCalibrationStatus(`${pendingTimestamp} Drop calibration strict: pending, drops paused`)

    const timer = window.setTimeout(() => {
      runDropCalibration({ auto: true, strict: true })
    }, DROP_CALIBRATION_START_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [live.isCapturing, runDropCalibration])

  async function startAudio(deviceId = audioDeviceId, { userInitiated = false } = {}) {
    if (userInitiated) {
      shouldAutoStartRef.current = true
    }
    if (startInFlightRef.current) return
    clearAutoStartRetry()
    startInFlightRef.current = true
    setIsStarting(true)
    genreAdjustedBpmRef.current = null
    fallbackGenreCandidateRef.current = { genre: null, count: 0 }
    edmTechnoRemapCandidateRef.current = { genre: null, count: 0 }
    const startToken = ++audioStartTokenRef.current
    try {
      const { audioContext, sourceNode } = await startCapture(deviceId)
      if (startToken !== audioStartTokenRef.current) {
        await stopCapture()
        return
      }
      const initialGain = getInputGain()
      setDashboardInputGain(initialGain, { immediate: true, trackAsAutoTarget: true })
      profileMapper.setDropTimingOffset(dropSessionOffsetRef.current)
      profileMapper.setDropTriggerSuppressed(false)
      profileMapper.setDropDetectionEnabled(dropCalibrationResolvedRef.current)

      await initGenreDetector(liveContexts)
      if (startToken !== audioStartTokenRef.current) {
        stopGenreDetector()
        await stopCapture()
        return
      }
      updateLive({ genreDetectorStatus: getGenreDetectorStatus() })

      if (
        startToken !== audioStartTokenRef.current
        || !audioContext
        || audioContext.state === 'closed'
      ) {
        stopGenreDetector()
        await stopCapture()
        return
      }

      await startBPMDetector(audioContext, sourceNode, (frame) => {
        if (startToken !== audioStartTokenRef.current) return
        if (shouldSuppressInputForCalibration()) return
        const liveState = useStore.getState().live || {}
        const effectiveGenre = lockedGenreRef.current || liveState.genre || 'unknown'
        const adjustedBpm = normalizeBpmByGenre(
          frame.bpm,
          effectiveGenre,
          genreAdjustedBpmRef.current,
        )
        if (Number.isFinite(adjustedBpm)) {
          genreAdjustedBpmRef.current = adjustedBpm
        }
        const frameWithAdjustedBpm = {
          ...frame,
          bpm: Number.isFinite(adjustedBpm) ? adjustedBpm : frame.bpm,
        }
        if (autoGainCollectingRef.current && !dropCalibrationRunningRef.current) {
          autoGainSamplesRef.current.push({
            rms: Number.isFinite(frame.rms) ? frame.rms : 0,
            peakAbs: Number.isFinite(frame.peakAbs) ? frame.peakAbs : 0,
            clipRatio: Number.isFinite(frame.clipRatio) ? frame.clipRatio : 0,
          })
        }

        if (holdFreezeRef.current) return

        updateLive({
          bpm: frameWithAdjustedBpm.bpm,
          energy: frame.energy,
          spectralCentroid: frame.spectralCentroid,
          rms: frame.rms,
          isSilent: frame.isSilent,
        })
        const currentGenre = liveState.genre || 'unknown'
        if (!lockedGenreRef.current && (currentGenre === 'edm' || currentGenre === 'techno')) {
          const remapGenre = inferEdmTechnoRemapGenre(currentGenre, frameWithAdjustedBpm.bpm)
          if (remapGenre !== currentGenre) {
            if (edmTechnoRemapCandidateRef.current.genre === remapGenre) {
              edmTechnoRemapCandidateRef.current.count += 1
            } else {
              edmTechnoRemapCandidateRef.current = { genre: remapGenre, count: 1 }
            }

            if (edmTechnoRemapCandidateRef.current.count >= EDM_TECHNO_REMAP_STABLE_FRAMES) {
              updateLive({
                genre: remapGenre,
                genreConfidence: Math.max(0.32, liveState.genreConfidence || 0),
              })
              profileMapper.onGenreChange(remapGenre, Math.max(0.32, liveState.genreConfidence || 0))
              edmTechnoRemapCandidateRef.current = { genre: null, count: 0 }
            }
          } else {
            edmTechnoRemapCandidateRef.current = { genre: null, count: 0 }
          }
        } else {
          edmTechnoRemapCandidateRef.current = { genre: null, count: 0 }
        }

        if (!lockedGenreRef.current && currentGenre === 'unknown') {
          const inferredGenre = inferFallbackGenreFromBpm(frameWithAdjustedBpm.bpm)
          if (inferredGenre !== 'unknown') {
            if (fallbackGenreCandidateRef.current.genre === inferredGenre) {
              fallbackGenreCandidateRef.current.count += 1
            } else {
              fallbackGenreCandidateRef.current = { genre: inferredGenre, count: 1 }
            }

            if (fallbackGenreCandidateRef.current.count >= GENRE_FALLBACK_MIN_STABLE_FRAMES) {
              updateLive({
                genre: inferredGenre,
                genreConfidence: 0.25,
              })
              profileMapper.onGenreChange(inferredGenre, 0.25)
            }
          } else {
            fallbackGenreCandidateRef.current = { genre: null, count: 0 }
          }
        } else {
          fallbackGenreCandidateRef.current = { genre: null, count: 0 }
        }
        setGenreRealtimeHint({
          bpm: frameWithAdjustedBpm.bpm ?? 0,
          centroid: frame.spectralCentroid ?? 0,
          energy: frame.energy ?? 0,
          lowBandEnergy: frame.lowBandEnergy ?? 0,
        })
        profileMapper.onAudioFrame(frameWithAdjustedBpm)
      })
      if (startToken !== audioStartTokenRef.current) {
        stopBPMDetector()
        stopGenreDetector()
        await stopCapture()
        return
      }

      const genreProcessor = await startGenreDetector(audioContext, (result) => {
        if (startToken !== audioStartTokenRef.current) return
        if (dropCalibrationRunningRef.current) return
        if (holdFreezeRef.current) return
        const liveState = useStore.getState().live || {}
        const bpmHint = Number.isFinite(liveState.bpm) ? liveState.bpm : genreAdjustedBpmRef.current
        const resolvedGenre = resolveAmbiguousGenre(result, bpmHint, liveState.genre)
        const resolvedConfidence = (result.topGenres || [])
          .find((entry) => entry?.genre === resolvedGenre)?.raw
          ?? result.rawConfidence
          ?? result.confidence
        const topGenres = (result.topGenres || []).slice(0, 3)

        updateLive({
          genre: resolvedGenre,
          genreConfidence: resolvedConfidence,
          topGenres,
        })
        profileMapper.onGenreChange(resolvedGenre, resolvedConfidence)
      })

      if (genreProcessor) {
        sourceNode.connect(genreProcessor)
        genreProcessorRef.current = genreProcessor
      }

      if (startToken !== audioStartTokenRef.current) {
        genreProcessorRef.current = null
        stopBPMDetector()
        stopGenreDetector()
        await stopCapture()
        return
      }

      updateLive({
        isCapturing: true,
        audioError: null,
        genreDetectorStatus: getGenreDetectorStatus(),
      })
      clearAutoStartRetry()
    } catch (err) {
      if (startToken !== audioStartTokenRef.current) {
        return
      }
      console.error('Failed to start audio:', err)
      genreProcessorRef.current = null
      stopBPMDetector()
      stopGenreDetector()
      await stopCapture()
      updateLive({
        isCapturing: false,
        audioError: err?.message || 'Unable to start microphone capture.',
      })

      const message = `${err?.name || ''} ${err?.message || ''}`
      const permissionDenied = /denied|notallowederror|permission/i.test(message)
      if (shouldAutoStartRef.current && !permissionDenied) {
        scheduleAutoStartRetry(deviceId)
      }
    } finally {
      startInFlightRef.current = false
      setIsStarting(false)
      if (shouldAutoStartRef.current && !useStore.getState().live?.isCapturing) {
        scheduleAutoStartRetry(deviceId)
      }
    }
  }

  async function stopAudio({ userInitiated = false } = {}) {
    if (userInitiated) {
      shouldAutoStartRef.current = false
    }
    audioStartTokenRef.current++
    clearAutoStartRetry()
    stopAutoGainLoop()
    genreAdjustedBpmRef.current = null
    fallbackGenreCandidateRef.current = { genre: null, count: 0 }
    edmTechnoRemapCandidateRef.current = { genre: null, count: 0 }
    genreProcessorRef.current = null
    if (!dropCalibrationResolvedRef.current) {
      dropCalibrationRanRef.current = false
    }
    profileMapper.setDropTriggerSuppressed(false)
    profileMapper.setDropDetectionEnabled(false)
    stopBPMDetector()
    stopGenreDetector()
    await stopCapture()
    updateLive({ isCapturing: false })
  }

  // ── Register profileMapper callbacks ──────────────────────────────────────

  useEffect(() => {
    profileMapper.setDropCallback(() => {
      setDropFlash(true)
      setTimeout(() => setDropFlash(false), 2500)
    })
    profileMapper.setHistoryCallback((entry) => {
      appendHistory(entry)
    })
    return () => {
      profileMapper.setDropCallback(null)
      profileMapper.setHistoryCallback(null)
    }
  }, [])

  // ── Genre transition flash ────────────────────────────────────────────────

  useEffect(() => {
    if (live.genre !== prevGenreRef.current) {
      prevGenreRef.current = live.genre
      setGenreFlash(true)
      setTimeout(() => setGenreFlash(false), 600)
    }
  }, [live.genre])

  // ── Sync overrides to profile mapper ─────────────────────────────────────

  useEffect(() => {
    if (overrides.lockedGenre) profileMapper.setLockedGenre(overrides.lockedGenre)
    else profileMapper.clearLockedGenre()
  }, [overrides.lockedGenre])

  useEffect(() => {
    Object.entries(overrides.disabledPhasers).forEach(([key, disabled]) => {
      profileMapper.setDisabledPhaser(key, disabled)
    })
  }, [overrides.disabledPhasers])

  useEffect(() => {
    if (overrides.manualBpm) profileMapper.setManualBpm(overrides.manualBpm)
    else profileMapper.clearManualBpm()
  }, [overrides.manualBpm])

  useEffect(() => {
    profileMapper.setBlackout(overrides.blackout)
  }, [overrides.blackout])

  useEffect(() => {
    profileMapper.setKillStrobe(overrides.killStrobe)
  }, [overrides.killStrobe])

  // ── OSC receive ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!osc.socketReady) return undefined

    let unsubscribe = () => {}
    const receivePort = osc.port + 1

    oscClient.startReceive(receivePort, (msg) => {
      setLastOscReceived({ address: msg.address, ts: Date.now() })
      updateOsc({ connected: true, lastError: null })
    }).then((result) => {
      unsubscribe = result.unsubscribe || (() => {})
    })

    return () => unsubscribe()
  }, [osc.socketReady, osc.port, updateOsc])

  // ── Tap tempo ─────────────────────────────────────────────────────────────

  function tap() {
    const now = Date.now()
    const recent = [...tapTimes, now].filter(t => now - t < 4000).slice(-8)
    setTapTimes(recent)
    if (recent.length >= 2) {
      const intervals = recent.slice(1).map((t, i) => t - recent[i])
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const bpm = Math.round(60000 / avgInterval)
      setManualBpm(bpm)
    }
  }

  // ── Tonight's context live editor ────────────────────────────────────────

  function toggleContext(id) {
    const next = liveContexts.includes(id)
      ? liveContexts.filter(g => g !== id)
      : [...liveContexts, id]
    setLiveContexts(next)
    setContextWeights(next)
  }

  // ── Panic presets ─────────────────────────────────────────────────────────

  function panicAllWhite() {
    // Send a warm white look via programmer (ClearAll + Dimmer 100 + white)
    oscClient.sendCmd('ClearAll')
    session.fixtureGroups?.forEach(g => {
      oscClient.sendCmd(`SelFix Group "${g.maGroupName}"`)
    })
    oscClient.sendCmd('Attribute "Dimmer" at 100')
    oscClient.sendCmd('Attribute "Saturation" at 0')
  }

  function panicFullBlackout() {
    setBlackout(true)
  }

  function panicHoldFreeze() {
    const next = !overrides.holdFreeze
    setHoldFreeze(next)
    if (next) profileMapper.setLockedGenre(live.genre || overrides.lockedGenre)
    else profileMapper.clearLockedGenre()
  }

  function panicHouseDefault() {
    if (panicConfig?.houseDefaultExec) {
      const { page, exec } = panicConfig.houseDefaultExec
      oscClient.pressKey(page, exec, true)
    }
  }

  // ── History auto-save ─────────────────────────────────────────────────────

  async function saveHistory() {
    if (!history.length) return
    const csv = ['time,genre,bpm,confidence',
      ...history.map(h => `${new Date(h.ts).toISOString()},${h.genre},${h.bpm},${(h.confidence * 100).toFixed(1)}`)
    ].join('\n')
    await window.electronAPI?.fileSave({
      defaultName: `disco-pilot-${session.name || 'session'}-${new Date().toISOString().slice(0, 10)}.csv`,
      content: csv,
      fileType: 'csv',
    })
  }

  // ── Current profile ───────────────────────────────────────────────────────

  const displayGenre = overrides.lockedGenre ?? live.genre ?? 'unknown'
  const profile = getProfile(displayGenre)

  const oscReceivedAgo = lastOscReceived
    ? Math.round((Date.now() - lastOscReceived.ts) / 1000)
    : null
  const displayedGain = Math.round(inputGain * 100) / 100
  const gainPercent = Math.round((inputGain / MAX_INPUT_GAIN) * 100)

  return (
    <div className={styles.dashboard}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <span className={styles.appTitle}>GMA3 Disco Pilot</span>
        {session.name && (
          <span style={{ fontSize: 11, color: '#444', marginLeft: 12 }}>{session.name}</span>
        )}

        <div style={{ flex: 1 }} />

        <div className={styles.oscStatus}>
          <div className={`${styles.oscDot} ${osc.connected ? styles.connected : osc.socketReady ? styles.ready : ''}`} />
          {osc.connected
            ? <>
                {`OSC verified ${osc.host}:${osc.port}`}
                {lastOscReceived && (
                  <span style={{ fontSize: 10, color: '#3a3a4a', marginLeft: 8 }}>
                    ← {lastOscReceived.address}
                  </span>
                )}
              </>
            : osc.socketReady
              ? `OSC socket ready ${osc.host}:${osc.port}`
              : 'OSC disconnected'
          }
        </div>

        <div className={styles.topBarRight}>
          {overrides.holdFreeze && (
            <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>
              FROZEN
            </span>
          )}
          {overrides.lockedGenre && !overrides.holdFreeze && (
            <span style={{ fontSize: 12, color: '#d4a82b' }}>
              Genre locked: {overrides.lockedGenre}
            </span>
          )}
          <button
            className={`${styles.btnSmall} ${overrides.killStrobe ? styles.btnDanger : ''}`}
            style={overrides.killStrobe ? { background: '#7f1d1d', borderColor: '#ef4444' } : {}}
            onClick={() => setKillStrobe(!overrides.killStrobe)}
            title="Kill strobe without blacking out everything"
          >
            {overrides.killStrobe ? 'STROBE KILLED' : 'Kill Strobe'}
          </button>
          <button
            className={`${styles.btnSmall} ${styles.btnDanger}`}
            style={overrides.blackout ? { background: '#000', borderColor: '#ef4444', color: '#ef4444' } : {}}
            onClick={() => setBlackout(!overrides.blackout)}
          >
            {overrides.blackout ? 'UN-BLACKOUT' : 'BLACKOUT'}
          </button>
          <button className={styles.btnSmall} onClick={() => setScreen('home')}>
            Setup
          </button>
        </div>
      </div>

      {/* Panel 1: Genre display */}
      <div
        className={`${styles.panel} ${styles.genrePanel}`}
        style={genreFlash ? { background: `${genreColors[live.genre] || '#6366f1'}18` } : {}}
      >
        <div className={styles.panelTitle}>
          Detected Genre
          {genreFlash && (
            <span style={{ marginLeft: 10, color: genreColors[live.genre], fontSize: 10, fontWeight: 700 }}>
              GENRE CHANGE
            </span>
          )}
        </div>

        {live.isSilent && (
          <div className={styles.silentBadge}>Silence — holding current look</div>
        )}

        <div
          className={styles.genreName}
          style={{
            color: genreColors[displayGenre] || '#fff',
            transition: 'color 0.6s, text-shadow 0.3s',
            textShadow: genreFlash ? `0 0 30px ${genreColors[live.genre] || '#6366f1'}` : 'none',
          }}
        >
          {profile.label}
          {overrides.lockedGenre && <span className={styles.lockedBadge}>locked</span>}
        </div>
        <div className={styles.genreConfidence}>
          {live.genreConfidence > 0
            ? `${Math.round(live.genreConfidence * 100)}% confidence`
            : 'Analyzing…'}
        </div>

        {(live.topGenres || []).slice(0, 3).map(({ genre, raw, weighted }) => (
          <div key={genre} className={styles.genreCandidateRow}>
            <span>{getProfile(genre).label}</span>
            <div style={{ flex: 1, margin: '0 12px' }}>
              <div className={styles.genreBar}>
                <div
                  className={styles.genreBarFill}
                  style={{
                    width: `${(raw || 0) * 100}%`,
                    background: genre === displayGenre ? genreColors[genre] : '#333',
                  }}
                />
              </div>
            </div>
            <span style={{ fontSize: 11, color: '#555', minWidth: 32, textAlign: 'right' }}>
              {Math.round((raw || 0) * 100)}% / {Math.round((weighted || 0) * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* Panel 2: Audio monitor */}
      <div
        className={`${styles.panel} ${styles.audioPanel}`}
        style={dropFlash ? { boxShadow: 'inset 0 0 0 2px #f59e0b' } : {}}
      >
        <div className={styles.panelTitle}>
          Audio
          {dropFlash && (
            <span style={{ marginLeft: 10, color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>
              DROP
            </span>
          )}
        </div>

        {live.audioError && (
          <div style={{ marginBottom: 12, color: '#fca5a5', fontSize: 11, lineHeight: 1.4 }}>
            {live.audioError}
          </div>
        )}

        {live.genreDetectorStatus && live.genreDetectorStatus.mode !== 'maest' && (
          <div style={{ marginBottom: 12, color: '#fbbf24', fontSize: 11, lineHeight: 1.45 }}>
            <strong>Genre detector status:</strong> {live.genreDetectorStatus.detail}
          </div>
        )}

        <div className={styles.bpmDisplay}>
          {overrides.manualBpm ?? live.bpm ?? '--'}
        </div>
        <div className={styles.bpmLabel}>
          BPM{overrides.manualBpm ? ' (manual)' : ''}
        </div>

        <div className={styles.meter}>
          <div className={styles.meterLabel}>
            <span>Energy</span>
            <span>{Math.round((live.energy || 0) * 1000) / 10}</span>
          </div>
          <div className={styles.meterTrack}>
            <div
              className={styles.meterFill}
              style={{
                width: `${Math.min(live.energy / 0.2 * 100, 100)}%`,
                background: dropFlash ? '#f59e0b' : live.energy > 0.15 ? '#22c55e' : '#6366f1',
              }}
            />
          </div>
        </div>

        <div className={styles.meter}>
          <div className={styles.meterLabel}>
            <span>Spectral</span>
            <span>{Math.round(live.spectralCentroid || 0)} Hz</span>
          </div>
          <div className={styles.meterTrack}>
            <div
              className={styles.meterFill}
              style={{
                width: `${Math.min((live.spectralCentroid || 0) / 10000 * 100, 100)}%`,
                background: '#f59e0b',
              }}
            />
          </div>
        </div>

        <div className={styles.gainSection}>
          <div className={styles.gainHeader}>
            <span>Input Gain</span>
            <span>{displayedGain.toFixed(2)}×</span>
          </div>
          <div className={styles.gainControls}>
            <input
              className={styles.gainSlider}
              type="range"
              min={MIN_INPUT_GAIN}
              max={MAX_INPUT_GAIN}
              step={0.05}
              value={inputGain}
              onChange={(e) => {
                setDashboardInputGain(Number(e.target.value), { immediate: true, trackAsAutoTarget: true })
              }}
            />
            <button
              className={`${styles.autoGainBtn} ${autoInputGain ? styles.autoGainBtnActive : ''}`}
              onClick={() => {
                const next = !autoInputGain
                if (next) {
                  autoGainTargetRef.current = inputGain
                }
                setAutoInputGain(next)
              }}
              title="Enable automatic 60-second input-gain checks"
            >
              {autoInputGain ? 'Auto On' : 'Auto Off'}
            </button>
            <button
              className={`${styles.autoGainBtn} ${dropCalibrationRunning ? styles.autoGainBtnActive : ''}`}
              onClick={() => runDropCalibration({ auto: false })}
              disabled={!live.isCapturing || dropCalibrationRunning}
              title="Play drop test audio and compute session drop timing offset"
            >
              {dropCalibrationRunning
                ? 'Calibrating…'
                : (Number.isFinite(dropSessionOffsetMs) ? 'Recalibrate Drop' : 'Calibrate Drop')}
            </button>
          </div>
          <div className={styles.gainMeta}>
            <span>Detection trim</span>
            <span>{gainPercent}% of max</span>
          </div>
          {Number.isFinite(dropSessionOffsetMs) && (
            <div style={{ marginTop: 6, color: '#556', fontSize: 10, lineHeight: 1.35 }}>
              Session drop offset: {dropSessionOffsetMs >= 0 ? '+' : ''}{dropSessionOffsetMs}ms
            </div>
          )}
          {autoGainStatus && (
            <div style={{ marginTop: 6, color: '#556', fontSize: 10, lineHeight: 1.35 }}>
              {autoGainStatus}
            </div>
          )}
          {dropCalibrationStatus && (
            <div style={{ marginTop: 6, color: '#556', fontSize: 10, lineHeight: 1.35 }}>
              {dropCalibrationStatus}
            </div>
          )}
        </div>

        {/* Audio device picker */}
        {audioDevices.length > 1 && (
          <div style={{ marginTop: 'auto' }}>
            <div style={{ fontSize: 10, color: '#444', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Input Device
            </div>
            <select
              style={{
                width: '100%', background: '#12121a', color: '#888', border: '1px solid #1e1e2e',
                borderRadius: 6, padding: '5px 8px', fontSize: 11, cursor: 'pointer',
              }}
              value={audioDeviceId || ''}
              onChange={async (e) => {
                const selectedDeviceId = e.target.value || null
                setAudioDeviceId(selectedDeviceId)
                await stopAudio()
                await startAudio(selectedDeviceId)
              }}
            >
              <option value="">Default</option>
              {audioDevices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Device ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Panel 3: Active profile params */}
      <div className={`${styles.panel} ${styles.profilePanel}`}>
        <div className={styles.panelTitle}>Active Profile — {profile.label}</div>

        {[
          { label: 'Color Temp',    value: profile.colorTemp,       color: profile.colorTemp > 0.5 ? '#f59e0b' : '#60a5fa' },
          { label: 'Saturation',    value: profile.saturation,      color: '#a78bfa' },
          { label: 'Movement Speed',value: profile.movementSpeed,   color: '#22c55e' },
          { label: 'Effect Size',   value: profile.effectSize,      color: '#f472b6' },
          { label: 'Strobe',        value: profile.strobeEnabled ? profile.strobeIntensity : 0, color: '#ef4444' },
        ].map(param => (
          <div key={param.label} className={styles.profileParam}>
            <span className={styles.profileParamLabel}>{param.label}</span>
            <div className={styles.profileParamBar}>
              <div
                className={styles.profileParamBarFill}
                style={{ width: `${param.value * 100}%`, background: param.color }}
              />
            </div>
            <span className={styles.profileParamValue}>{Math.round(param.value * 100)}</span>
          </div>
        ))}

        <div style={{ marginTop: 16, fontSize: 12, color: '#555' }}>
          BPM tracking: {profile.bpmTracking ? '✓' : '—'} &nbsp;
          Strobe: {profile.strobeEnabled ? '✓' : '—'} &nbsp;
          Transition: {profile.transitionTime}s
        </div>
      </div>

      {/* Panel 4: Controls + Context editor */}
      <div className={`${styles.panel} ${styles.controlsPanel}`}>
        <div className={styles.panelTitle}>Controls</div>
        <div className={styles.overrideGrid}>
          <button
            className={`${styles.overrideBtn} ${overrides.manualBpm ? styles.active : ''}`}
            onClick={tap}
          >
            <div className={styles.overrideBtnLabel}>Tap BPM</div>
            <div className={styles.overrideBtnValue}>
              {overrides.manualBpm ? `${overrides.manualBpm} BPM` : 'Tap…'}
            </div>
          </button>

          <button
            className={styles.overrideBtn}
            onClick={clearManualBpm}
            disabled={!overrides.manualBpm}
          >
            <div className={styles.overrideBtnLabel}>BPM</div>
            <div className={styles.overrideBtnValue}>Auto {overrides.manualBpm ? '↩' : '✓'}</div>
          </button>

          <button
            className={`${styles.overrideBtn} ${overrides.lockedGenre ? styles.active : ''}`}
            onClick={clearLockedGenre}
          >
            <div className={styles.overrideBtnLabel}>Genre</div>
            <div className={styles.overrideBtnValue}>
              {overrides.lockedGenre ? 'Unlock' : 'Auto ✓'}
            </div>
          </button>

          <button
            className={`${styles.overrideBtn} ${live.isCapturing ? styles.active : ''}`}
            onClick={() => live.isCapturing
              ? stopAudio({ userInitiated: true })
              : startAudio(audioDeviceId, { userInitiated: true })}
          >
            <div className={styles.overrideBtnLabel}>Microphone</div>
            <div className={styles.overrideBtnValue}>
              {isStarting ? '…' : live.isCapturing ? '● Live' : '○ Off'}
            </div>
          </button>
        </div>

        {/* Tonight's context live editor */}
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => setShowContextEditor(v => !v)}
            style={{
              background: 'none', border: 'none', color: '#555', fontSize: 11,
              cursor: 'pointer', padding: '4px 0', textTransform: 'uppercase', letterSpacing: '0.08em',
            }}
          >
            {showContextEditor ? '▾' : '▸'} Tonight's Context
          </button>
          {showContextEditor && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TONIGHT_CONTEXTS.map(ctx => {
                const active = liveContexts.includes(ctx.id)
                return (
                  <button
                    key={ctx.id}
                    onClick={() => toggleContext(ctx.id)}
                    style={{
                      padding: '4px 10px', borderRadius: 14, fontSize: 11, cursor: 'pointer',
                      border: `1px solid ${active ? '#6366f1' : '#1e1e2e'}`,
                      background: active ? '#1e1e3a' : '#12121a',
                      color: active ? '#a5b4fc' : '#555',
                    }}
                  >
                    {ctx.label}
                  </button>
                )
              })}
              <p style={{ width: '100%', fontSize: 10, color: '#3a3a4a', margin: '4px 0 0' }}>
                Checked genres get 2× weight boost in detection.
              </p>
            </div>
          )}
        </div>

        {/* History */}
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setShowHistory(v => !v)}
            style={{
              background: 'none', border: 'none', color: '#555', fontSize: 11,
              cursor: 'pointer', padding: '4px 0', textTransform: 'uppercase', letterSpacing: '0.08em',
            }}
          >
            {showHistory ? '▾' : '▸'} History ({history.length})
          </button>
          {showHistory && (
            <div style={{ marginTop: 6, maxHeight: 140, overflowY: 'auto' }}>
              {history.length === 0 && (
                <p style={{ fontSize: 11, color: '#3a3a4a' }}>No genre changes yet.</p>
              )}
              {[...history].reverse().slice(0, 30).map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, color: '#555', marginBottom: 3 }}>
                  <span style={{ color: '#3a3a4a', minWidth: 56 }}>
                    {new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span style={{ color: genreColors[h.genre] || '#888' }}>{getProfile(h.genre).label}</span>
                  <span>{h.bpm} BPM</span>
                  <span style={{ color: '#3a3a4a' }}>{Math.round(h.confidence * 100)}%</span>
                </div>
              ))}
              {history.length > 0 && (
                <button
                  onClick={saveHistory}
                  style={{
                    marginTop: 8, padding: '4px 12px', background: '#12121a',
                    border: '1px solid #1e1e2e', borderRadius: 6, color: '#666',
                    fontSize: 11, cursor: 'pointer',
                  }}
                >
                  Export CSV
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Panel 5: Genre chips + Panic presets */}
      <div className={`${styles.panel} ${styles.genreSelectorPanel}`}>
        <div className={styles.panelTitle}>Force Genre</div>
        <div className={styles.genreChips}>
          {TONIGHT_CONTEXTS.map(ctx => (
            <button
              key={ctx.id}
              className={`${styles.genreChip} ${live.genre === ctx.id && !overrides.lockedGenre ? styles.current : ''} ${overrides.lockedGenre === ctx.id ? styles.locked : ''}`}
              onClick={() => {
                if (overrides.lockedGenre === ctx.id) {
                  clearLockedGenre()
                } else {
                  setLockedGenre(ctx.id)
                  profileMapper.forceGenre(ctx.id)
                }
              }}
            >
              {ctx.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11, color: '#444', marginTop: 12 }}>
          Tap to lock. Tap again to release.
        </p>

        {/* Panic presets */}
        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #111118' }}>
          <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Panic Presets
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button className={`${styles.panicBtn} ${styles.panicWhite}`} onClick={panicAllWhite}>
              All White
            </button>
            <button
              className={`${styles.panicBtn} ${styles.panicBlackout}`}
              onClick={panicFullBlackout}
              style={overrides.blackout ? { background: '#000', borderColor: '#ef4444' } : {}}
            >
              {overrides.blackout ? 'UN-BLACKOUT' : 'Full Blackout'}
            </button>
            <button
              className={`${styles.panicBtn} ${styles.panicFreeze}`}
              onClick={panicHoldFreeze}
              style={overrides.holdFreeze ? { borderColor: '#ef4444', color: '#fca5a5' } : {}}
            >
              {overrides.holdFreeze ? 'FROZEN — tap to thaw' : 'Hold + Freeze'}
            </button>
            <button
              className={`${styles.panicBtn} ${styles.panicHouse}`}
              onClick={panicHouseDefault}
              title={panicConfig?.houseDefaultExec ? `Fires Page ${panicConfig.houseDefaultExec.page} Exec ${panicConfig.houseDefaultExec.exec}` : 'Configure in settings'}
            >
              House Default
            </button>
          </div>
        </div>
      </div>

      {/* Panel 6: Phaser toggles + Strobe kill */}
      <div className={`${styles.panel} ${styles.phasersPanel}`}>
        <div className={styles.panelTitle}>Phasers</div>
        {PHASER_DEFS.map(p => {
          const isDisabled = !!overrides.disabledPhasers[p.key]
          const moverProfileActive = (p.key === 'panOnly' || p.key === 'tiltOnly') && profile.phasers.ptSlow
          const isActive = !isDisabled && (profile.phasers[p.key] || moverProfileActive)
          return (
            <div key={p.key} className={styles.phaserRow}>
              <span id={`phaser-label-${p.key}`} className={styles.phaserLabel}>
                {p.label}
                {isActive && <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 11 }}>● active</span>}
                {isDisabled && <span style={{ marginLeft: 8, color: '#555', fontSize: 11 }}>off</span>}
              </span>
              <label className={styles.toggleSwitch}>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={p.label}
                  aria-labelledby={`phaser-label-${p.key}`}
                  aria-checked={!isDisabled}
                  checked={!isDisabled}
                  onChange={() => togglePhaser(p.key)}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>
          )
        })}

        {/* Strobe kill (dedicated row) */}
        <div className={styles.phaserRow} style={{ marginTop: 8, borderTop: '1px solid #1a1a28', paddingTop: 12 }}>
          <span
            id="phaser-label-strobe"
            className={styles.phaserLabel}
            style={{ color: overrides.killStrobe ? '#ef4444' : undefined }}
          >
            Strobe Kill
            {overrides.killStrobe && <span style={{ marginLeft: 8, color: '#ef4444', fontSize: 11 }}>ACTIVE</span>}
          </span>
          <label className={styles.toggleSwitch}>
            <input
              type="checkbox"
              role="switch"
              aria-label="Strobe Kill"
              aria-labelledby="phaser-label-strobe"
              aria-checked={overrides.killStrobe}
              checked={overrides.killStrobe}
              onChange={() => setKillStrobe(!overrides.killStrobe)}
            />
            <span className={styles.toggleSlider} style={overrides.killStrobe ? { background: '#7f1d1d' } : {}} />
          </label>
        </div>

        <p style={{ fontSize: 11, color: '#444', marginTop: 12 }}>
          Phaser disable overrides the genre profile.<br />
          Strobe kill cuts strobe independently of blackout.
        </p>
      </div>
    </div>
  )
}

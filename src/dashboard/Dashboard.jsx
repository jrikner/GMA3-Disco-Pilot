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
import styles from './Dashboard.module.css'

const AUTO_GAIN_TARGET_RMS = 0.11
const AUTO_GAIN_MIN_ACTIVE_RMS = 0.012
const AUTO_GAIN_STABLE_LOW_RMS = 0.08
const AUTO_GAIN_STABLE_HIGH_RMS = 0.15
const AUTO_GAIN_ADJUSTMENT_ALPHA = 0.18
const AUTO_GAIN_STEP_LIMIT = 0.18
const MIN_INPUT_GAIN = 0.25
const MAX_INPUT_GAIN = 8

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
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
  const autoGainCooldownRef = useRef(0)
  const autoInputGainRef = useRef(autoInputGain)

  // ── Start / Stop capture ──────────────────────────────────────────────────

  useEffect(() => {
    loadAudioDevices()
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

  useEffect(() => {
    startAudio()
    return () => stopAudio()
  }, [])

  useEffect(() => {
    applyInputGain(inputGain, { immediate: true })
  }, [inputGain])

  useEffect(() => {
    autoInputGainRef.current = autoInputGain
    if (!autoInputGain) {
      autoGainCooldownRef.current = 0
    }
  }, [autoInputGain])

  async function startAudio(deviceId = audioDeviceId) {
    if (isStarting) return
    setIsStarting(true)
    try {
      const { audioContext, sourceNode } = await startCapture(deviceId)
      const initialGain = getInputGain()
      setInputGain(initialGain)

      await initGenreDetector(liveContexts)
      updateLive({ genreDetectorStatus: getGenreDetectorStatus() })

      await startBPMDetector(audioContext, sourceNode, (frame) => {
        if (overrides.holdFreeze) return

        if (autoInputGainRef.current) {
          const now = performance.now()
          const measuredRms = frame.rms ?? 0
          const needsGainCorrection =
            measuredRms < AUTO_GAIN_STABLE_LOW_RMS || measuredRms > AUTO_GAIN_STABLE_HIGH_RMS

          if (!frame.isSilent && measuredRms >= AUTO_GAIN_MIN_ACTIVE_RMS && needsGainCorrection && now >= autoGainCooldownRef.current) {
            const currentGain = getInputGain()
            const targetGain = clamp(currentGain * (AUTO_GAIN_TARGET_RMS / measuredRms), MIN_INPUT_GAIN, MAX_INPUT_GAIN)
            const limitedTarget = clamp(
              targetGain,
              currentGain * (1 - AUTO_GAIN_STEP_LIMIT),
              currentGain * (1 + AUTO_GAIN_STEP_LIMIT),
            )
            const nextGain = clamp(
              currentGain + (limitedTarget - currentGain) * AUTO_GAIN_ADJUSTMENT_ALPHA,
              MIN_INPUT_GAIN,
              MAX_INPUT_GAIN,
            )

            if (Math.abs(nextGain - currentGain) >= 0.01) {
              const appliedGain = applyInputGain(nextGain)
              setInputGain(appliedGain)
              autoGainCooldownRef.current = now + 180
            }
          }
        }

        updateLive({
          bpm: frame.bpm,
          energy: frame.energy,
          spectralCentroid: frame.spectralCentroid,
          rms: frame.rms,
          isSilent: frame.isSilent,
        })
        setGenreRealtimeHint({
          bpm: frame.bpm ?? 0,
          centroid: frame.spectralCentroid ?? 0,
          energy: frame.energy ?? 0,
          lowBandEnergy: frame.lowBandEnergy ?? 0,
        })
        profileMapper.onAudioFrame(frame)
      })

      const genreProcessor = await startGenreDetector(audioContext, (result) => {
        if (overrides.holdFreeze) return
        const topGenres = (result.topGenres || []).slice(0, 3)

        updateLive({
          genre: result.genre,
          genreConfidence: result.rawConfidence ?? result.confidence,
          topGenres,
        })
        profileMapper.onGenreChange(result.genre, result.rawConfidence ?? result.confidence)
      })

      if (genreProcessor) {
        sourceNode.connect(genreProcessor)
        genreProcessorRef.current = genreProcessor
      }

      updateLive({
        isCapturing: true,
        audioError: null,
        genreDetectorStatus: getGenreDetectorStatus(),
      })
    } catch (err) {
      console.error('Failed to start audio:', err)
      genreProcessorRef.current = null
      stopBPMDetector()
      stopGenreDetector()
      await stopCapture()
      updateLive({
        isCapturing: false,
        audioError: err?.message || 'Unable to start microphone capture.',
      })
    }
    setIsStarting(false)
  }

  async function stopAudio() {
    genreProcessorRef.current = null
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
                const nextGain = Number(e.target.value)
                const appliedGain = applyInputGain(nextGain, { immediate: true })
                setInputGain(appliedGain)
              }}
            />
            <button
              className={`${styles.autoGainBtn} ${autoInputGain ? styles.autoGainBtnActive : ''}`}
              onClick={() => setAutoInputGain(!autoInputGain)}
              title="Automatically ride the microphone gain toward a stable detection level."
            >
              {autoInputGain ? 'Auto On' : 'Auto Off'}
            </button>
          </div>
          <div className={styles.gainMeta}>
            <span>Detection trim</span>
            <span>{gainPercent}% of max</span>
          </div>
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
            onClick={() => live.isCapturing ? stopAudio() : startAudio()}
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
              <span className={styles.phaserLabel}>
                {p.label}
                {isActive && <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 11 }}>● active</span>}
                {isDisabled && <span style={{ marginLeft: 8, color: '#555', fontSize: 11 }}>off</span>}
              </span>
              <label className={styles.toggleSwitch}>
                <input
                  type="checkbox"
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
          <span className={styles.phaserLabel} style={{ color: overrides.killStrobe ? '#ef4444' : undefined }}>
            Strobe Kill
            {overrides.killStrobe && <span style={{ marginLeft: 8, color: '#ef4444', fontSize: 11 }}>ACTIVE</span>}
          </span>
          <label className={styles.toggleSwitch}>
            <input
              type="checkbox"
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

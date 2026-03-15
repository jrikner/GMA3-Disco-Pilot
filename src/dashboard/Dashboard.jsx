/**
 * Main live operator dashboard.
 *
 * Panels:
 *   - Genre Display (col 1, row 2)
 *   - Audio Monitor / BPM (col 2, row 2)
 *   - Active Profile params (col 3, row 2)
 *   - Manual Overrides (col 1, row 3)
 *   - Genre selector / lock (col 2, row 3)
 *   - Phaser toggles (col 3, row 3)
 */

import React, { useEffect, useRef, useState } from 'react'
import useStore from '../store/appState.js'
import { startCapture, stopCapture } from '../audio/capture.js'
import { startBPMDetector, stopBPMDetector } from '../audio/bpmDetector.js'
import { initGenreDetector, startGenreDetector, stopGenreDetector } from '../audio/genreDetector.js'
import * as profileMapper from '../profiles/profileMapper.js'
import { getProfile, ALL_GENRES, TONIGHT_CONTEXTS } from '../profiles/genreProfiles.js'
import styles from './Dashboard.module.css'

const PHASER_DEFS = [
  { key: 'ptSlow',     label: 'P/T Slow' },
  { key: 'ptFast',     label: 'P/T Fast' },
  { key: 'colorChase', label: 'Color Chase' },
  { key: 'dimPulse',   label: 'Dimmer Pulse' },
]

export default function Dashboard() {
  const { live, updateLive, osc, overrides, setLockedGenre, clearLockedGenre,
          setManualBpm, clearManualBpm, togglePhaser, setBlackout, setScreen,
          session, updateSession } = useStore()

  const genreProcessorRef = useRef(null)
  const [tapTimes, setTapTimes] = useState([])
  const [isStarting, setIsStarting] = useState(false)

  // ── Start / Stop capture ──────────────────────────────────────────────────

  useEffect(() => {
    startAudio()
    return () => stopAudio()
  }, [])

  async function startAudio() {
    if (live.isCapturing) return
    setIsStarting(true)
    try {
      const { audioContext, sourceNode } = await startCapture()

      // Init genre detector with tonight's context
      await initGenreDetector(session.tonightContexts || [])

      // Start BPM detector
      startBPMDetector(audioContext, sourceNode, (frame) => {
        updateLive({
          bpm: frame.bpm,
          energy: frame.energy,
          spectralCentroid: frame.spectralCentroid,
          rms: frame.rms,
          isSilent: frame.isSilent,
        })
        profileMapper.onAudioFrame(frame)
      })

      // Start genre detector (returns a ScriptProcessor to connect)
      const genreProcessor = startGenreDetector(audioContext, (result) => {
        const topGenres = Object.entries(result.scores || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([genre, score]) => ({ genre, score }))

        updateLive({
          genre: result.genre,
          genreConfidence: result.confidence,
          topGenres,
        })
        profileMapper.onGenreChange(result.genre)
      })

      if (genreProcessor) {
        sourceNode.connect(genreProcessor)
        genreProcessor.connect(audioContext.destination)
        genreProcessorRef.current = genreProcessor
      }

      updateLive({ isCapturing: true })
    } catch (err) {
      console.error('Failed to start audio:', err)
    }
    setIsStarting(false)
  }

  async function stopAudio() {
    stopBPMDetector()
    stopGenreDetector()
    await stopCapture()
    updateLive({ isCapturing: false })
  }

  // ── Sync overrides to profile mapper ─────────────────────────────────────

  useEffect(() => {
    if (overrides.lockedGenre) {
      profileMapper.setLockedGenre(overrides.lockedGenre)
    } else {
      profileMapper.clearLockedGenre()
    }
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

  // ── Current profile ───────────────────────────────────────────────────────

  const displayGenre = overrides.lockedGenre ?? live.genre ?? 'unknown'
  const profile = getProfile(displayGenre)

  // Genre color mapping for the big genre name display
  const genreColors = {
    techno: '#60a5fa', edm: '#a78bfa', hiphop: '#f59e0b',
    pop: '#f472b6', eighties: '#fb923c', latin: '#4ade80',
    rock: '#ef4444', corporate: '#94a3b8', unknown: '#555',
  }

  return (
    <div className={styles.dashboard}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <span className={styles.appTitle}>GMA3 Disco Pilot</span>

        <div style={{ flex: 1 }} />

        <div className={styles.oscStatus}>
          <div className={`${styles.oscDot} ${osc.connected ? styles.connected : ''}`} />
          {osc.connected ? `OSC ${osc.host}:${osc.port}` : 'OSC disconnected'}
        </div>

        <div className={styles.topBarRight}>
          {overrides.lockedGenre && (
            <span style={{ fontSize: 12, color: '#d4a82b' }}>
              🔒 Genre locked: {overrides.lockedGenre}
            </span>
          )}
          <button className={`${styles.btnSmall} ${styles.btnDanger}`} onClick={() => {
            setBlackout(!overrides.blackout)
          }}>
            {overrides.blackout ? 'Un-Blackout' : 'Blackout'}
          </button>
          <button className={styles.btnSmall} onClick={() => setScreen('home')}>
            ⚙ Setup
          </button>
        </div>
      </div>

      {/* Panel 1: Genre display */}
      <div className={`${styles.panel} ${styles.genrePanel}`}>
        <div className={styles.panelTitle}>Detected Genre</div>

        {live.isSilent && (
          <div className={styles.silentBadge}>⏸ Silence — holding current look</div>
        )}

        <div className={styles.genreName} style={{ color: genreColors[displayGenre] || '#fff' }}>
          {profile.label}
          {overrides.lockedGenre && <span className={styles.lockedBadge}>🔒 locked</span>}
        </div>
        <div className={styles.genreConfidence}>
          {live.genreConfidence > 0
            ? `${Math.round(live.genreConfidence * 100)}% confidence`
            : 'Analyzing…'}
        </div>

        {/* Top 3 candidates */}
        {(live.topGenres || []).slice(0, 3).map(({ genre, score }) => (
          <div key={genre} className={styles.genreCandidateRow}>
            <span>{getProfile(genre).label}</span>
            <div style={{ flex: 1, margin: '0 12px' }}>
              <div className={styles.genreBar}>
                <div
                  className={styles.genreBarFill}
                  style={{
                    width: `${score * 100}%`,
                    background: genre === displayGenre ? genreColors[genre] : '#333',
                  }}
                />
              </div>
            </div>
            <span style={{ fontSize: 11, color: '#555', minWidth: 32, textAlign: 'right' }}>
              {Math.round(score * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* Panel 2: Audio monitor */}
      <div className={`${styles.panel} ${styles.audioPanel}`}>
        <div className={styles.panelTitle}>Audio</div>

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
                background: live.energy > 0.15 ? '#22c55e' : '#6366f1',
              }}
            />
          </div>
        </div>

        <div className={styles.meter}>
          <div className={styles.meterLabel}>
            <span>Brightness (spectral)</span>
            <span>{Math.round((live.spectralCentroid || 0))} Hz</span>
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

        {live.isSilent && (
          <div className={styles.silentBadge}>⏸ Silent</div>
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

      {/* Panel 4: Manual overrides */}
      <div className={`${styles.panel} ${styles.controlsPanel}`}>
        <div className={styles.panelTitle}>Controls</div>
        <div className={styles.overrideGrid}>
          {/* Tap tempo */}
          <button
            className={`${styles.overrideBtn} ${overrides.manualBpm ? styles.active : ''}`}
            onClick={tap}
          >
            <div className={styles.overrideBtnLabel}>Tap BPM</div>
            <div className={styles.overrideBtnValue}>
              {overrides.manualBpm ? `${overrides.manualBpm} BPM` : 'Tap…'}
            </div>
          </button>

          {/* Clear manual BPM */}
          <button
            className={styles.overrideBtn}
            onClick={clearManualBpm}
            disabled={!overrides.manualBpm}
          >
            <div className={styles.overrideBtnLabel}>BPM</div>
            <div className={styles.overrideBtnValue}>Auto {overrides.manualBpm ? '↩' : '✓'}</div>
          </button>

          {/* Clear genre lock */}
          <button
            className={`${styles.overrideBtn} ${overrides.lockedGenre ? styles.active : ''}`}
            onClick={clearLockedGenre}
          >
            <div className={styles.overrideBtnLabel}>Genre</div>
            <div className={styles.overrideBtnValue}>
              {overrides.lockedGenre ? '🔒 Unlock' : 'Auto ✓'}
            </div>
          </button>

          {/* Audio on/off */}
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
      </div>

      {/* Panel 5: Genre chips */}
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
      </div>

      {/* Panel 6: Phaser toggles */}
      <div className={`${styles.panel} ${styles.phasersPanel}`}>
        <div className={styles.panelTitle}>Phasers</div>
        {PHASER_DEFS.map(p => {
          const isDisabled = !!overrides.disabledPhasers[p.key]
          const isActive = !isDisabled && profile.phasers[p.key]
          return (
            <div key={p.key} className={styles.phaserRow}>
              <span className={styles.phaserLabel}>
                {p.label}
                {isActive && <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 11 }}>● active</span>}
                {isDisabled && <span style={{ marginLeft: 8, color: '#555', fontSize: 11 }}>disabled</span>}
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
        <p style={{ fontSize: 11, color: '#444', marginTop: 12 }}>
          Disabling a phaser here overrides the genre profile.
          Re-enable to let the profile decide.
        </p>
      </div>
    </div>
  )
}

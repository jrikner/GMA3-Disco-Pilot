import React, { useState, useRef } from 'react'
import useStore from '../store/appState.js'
import * as oscClient from '../osc/client.js'
import { getAllExecutors, setBoundary } from '../osc/addressMap.js'
import styles from './Wizard.module.css'

const SWEEP_STEPS = 20
const SWEEP_INTERVAL_MS = 100

export default function Calibration() {
  const { session, updateSession } = useStore()
  const executors = getAllExecutors()

  const [currentIdx, setCurrentIdx] = useState(0)
  const [sweeping, setSweeping] = useState(false)
  const [sweepDirection, setSweepDirection] = useState('up')  // 'up' | 'down'
  const [currentValue, setCurrentValue] = useState(0)
  const [localBoundaries, setLocalBoundaries] = useState({})
  const [allDone, setAllDone] = useState(false)
  const sweepRef = useRef(null)

  const currentExec = executors[currentIdx]

  const startSweep = (direction) => {
    if (sweepRef.current) clearInterval(sweepRef.current)
    setSweeping(true)
    setSweepDirection(direction)
    let step = direction === 'up' ? 0 : SWEEP_STEPS

    sweepRef.current = setInterval(() => {
      if (direction === 'up') step++
      else step--

      const val = step / SWEEP_STEPS
      setCurrentValue(val)

      if (currentExec) {
        oscClient.setFader(currentExec.page, currentExec.exec, val)
      }

      const done = direction === 'up' ? step >= SWEEP_STEPS : step <= 0
      if (done) {
        clearInterval(sweepRef.current)
        setSweeping(false)
      }
    }, SWEEP_INTERVAL_MS)
  }

  const markMax = () => {
    const key = `${currentExec.page}_${currentExec.exec}`
    setLocalBoundaries(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), max: currentValue },
    }))
    setBoundary(currentExec.page, currentExec.exec, localBoundaries[key]?.min ?? 0, currentValue)
    // Start sweeping back down
    setTimeout(() => startSweep('down'), 300)
  }

  const markMin = () => {
    const key = `${currentExec.page}_${currentExec.exec}`
    const max = localBoundaries[key]?.max ?? 1
    setLocalBoundaries(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), min: currentValue },
    }))
    setBoundary(currentExec.page, currentExec.exec, currentValue, max)
    // Move to next executor
    const nextIdx = currentIdx + 1
    if (nextIdx >= executors.length) {
      // Save all boundaries to session
      updateSession({ boundaries: localBoundaries })
      setAllDone(true)
    } else {
      setCurrentIdx(nextIdx)
      setCurrentValue(0)
    }
  }

  const savePersist = async () => {
    const name = session.name || 'default'
    await window.electronAPI?.profileSave({
      name,
      data: {
        session,
        boundaries: localBoundaries,
        addressMap: session.addressMap,
      },
    })
  }

  if (allDone) {
    return (
      <div>
        <h2 className={styles.stepTitle}>Calibration Complete ✓</h2>
        <p className={styles.stepDesc}>
          All fader boundaries have been saved. The app will now stay within these limits during the show.
        </p>
        <div className={styles.card}>
          <div className={styles.label}>Session Name</div>
          <div className={styles.row}>
            <input
              className={styles.input}
              placeholder="Friday Club Night"
              value={session.name || ''}
              onChange={e => updateSession({ name: e.target.value })}
            />
            <button className={styles.btnPrimary} onClick={savePersist}>
              Save Profile
            </button>
          </div>
          <p style={{ fontSize: 13, color: '#666', marginTop: 12 }}>
            Save this profile to reuse it next time — skip the wizard and load directly.
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.label} style={{ marginBottom: 12 }}>Boundary Summary</div>
          {executors.map(exec => {
            const key = `${exec.page}_${exec.exec}`
            const b = localBoundaries[key]
            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8, color: '#aaa' }}>
                <span>{exec.label}</span>
                <span style={{ color: '#ccc' }}>
                  {b ? `${Math.round(b.min * 100)}% – ${Math.round(b.max * 100)}%` : 'Not calibrated'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (!currentExec) return null

  const key = `${currentExec.page}_${currentExec.exec}`
  const localB = localBoundaries[key]
  const hasMax = localB?.max != null

  return (
    <div>
      <h2 className={styles.stepTitle}>Fader Calibration</h2>
      <p className={styles.stepDesc}>
        We'll sweep each executor fader and ask you to set the safe max and min boundaries.
        The app will never go outside these limits during the show.
      </p>

      <div style={{ fontSize: 12, color: '#666', marginBottom: 24 }}>
        Executor {currentIdx + 1} of {executors.length}
      </div>

      <div className={styles.card}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
          {currentExec.label}
        </div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 24 }}>
          Page {currentExec.page}, Executor {currentExec.exec}
        </div>

        {/* Visual fader */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 6 }}>
            <span>0%</span>
            <span style={{ color: '#a5b4fc', fontWeight: 700, fontSize: 18 }}>
              {Math.round(currentValue * 100)}%
            </span>
            <span>100%</span>
          </div>
          <div style={{ height: 12, background: '#1e1e2e', borderRadius: 6, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${currentValue * 100}%`,
                background: sweeping
                  ? (sweepDirection === 'up' ? '#6366f1' : '#f59e0b')
                  : '#6366f1',
                transition: 'width 0.05s linear',
                borderRadius: 6,
              }}
            />
          </div>
          {localB?.max != null && (
            <div style={{ position: 'relative', height: 8 }}>
              <div style={{ position: 'absolute', left: `${localB.max * 100}%`, top: -6, width: 2, height: 14, background: '#22c55e' }} />
            </div>
          )}
        </div>

        {!sweeping && !hasMax && (
          <div>
            <p style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>
              Press <strong style={{ color: '#6366f1' }}>Start Sweep ↑</strong> to slowly bring this fader up.
              When you see the lighting reach the level you want as the maximum for this executor, press <strong style={{ color: '#22c55e' }}>Mark as MAX</strong>.
            </p>
            <button className={styles.btnPrimary} onClick={() => startSweep('up')}>
              Start Sweep ↑
            </button>
          </div>
        )}

        {sweeping && sweepDirection === 'up' && (
          <div>
            <p style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>
              Fader is sweeping up. Press <strong style={{ color: '#22c55e' }}>Mark as MAX</strong> when the level looks right.
            </p>
            <button
              onClick={markMax}
              style={{
                padding: '12px 32px', background: '#166534', color: '#86efac',
                border: '2px solid #22c55e', borderRadius: 8, fontSize: 14,
                fontWeight: 700, cursor: 'pointer',
              }}
            >
              ✓ Mark as MAX
            </button>
          </div>
        )}

        {!sweeping && hasMax && !localB?.min && (
          <div>
            <p style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>
              Good — MAX saved at {Math.round(localB.max * 100)}%.
              The fader is now sweeping back down. Press <strong style={{ color: '#f59e0b' }}>Mark as MIN</strong> when it reaches the minimum acceptable level.
            </p>
            <button className={styles.btnPrimary} style={{ background: '#92400e' }} onClick={() => startSweep('down')}>
              Start Sweep ↓
            </button>
          </div>
        )}

        {sweeping && sweepDirection === 'down' && (
          <div>
            <p style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>
              Fader is sweeping down. Press <strong style={{ color: '#f59e0b' }}>Mark as MIN</strong> when the level is the lowest acceptable for this executor.
            </p>
            <button
              onClick={markMin}
              style={{
                padding: '12px 32px', background: '#78350f', color: '#fcd34d',
                border: '2px solid #f59e0b', borderRadius: 8, fontSize: 14,
                fontWeight: 700, cursor: 'pointer',
              }}
            >
              ✓ Mark as MIN
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

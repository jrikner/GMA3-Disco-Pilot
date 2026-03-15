import React from 'react'
import useStore from '../store/appState.js'
import { buildAddressMapFromWizard, getAllExecutors } from '../osc/addressMap.js'
import styles from './Wizard.module.css'

// Number of executor slots the plugin needs
const EXECUTORS_NEEDED = 8 + 4 + 2  // 8 color looks + 4 phasers + 2 masters = 14

export default function ExecutorMap() {
  const { session, updateSession } = useStore()
  const page = session.freeExecutorPage ?? 2
  const startExec = session.freeExecutorStart ?? 1
  const endExec = startExec + EXECUTORS_NEEDED - 1

  const setPage = (v) => updateSession({ freeExecutorPage: Number(v) })
  const setStart = (v) => {
    const n = Math.max(1, Number(v))
    updateSession({ freeExecutorStart: n })
    // Pre-build the address map so the LUA generator can use it
    const map = buildAddressMapFromWizard({ page, startExec: n })
    updateSession({ addressMap: map })
  }

  // Build preview of what will be allocated
  const buildPreview = () => {
    let exec = startExec
    const rows = []
    const genres = ['techno', 'edm', 'hiphop', 'pop', 'eighties', 'latin', 'rock', 'corporate']
    genres.forEach(g => rows.push({ exec: exec++, label: `Color Look: ${g}`, type: 'color' }))
    rows.push({ exec: exec++, label: 'Phaser: Pan/Tilt Slow', type: 'phaser' })
    rows.push({ exec: exec++, label: 'Phaser: Pan/Tilt Fast', type: 'phaser' })
    rows.push({ exec: exec++, label: 'Phaser: Color Chase', type: 'phaser' })
    rows.push({ exec: exec++, label: 'Phaser: Dimmer Pulse', type: 'phaser' })
    rows.push({ exec: exec++, label: 'Master: BPM Rate', type: 'master' })
    rows.push({ exec: exec++, label: 'Master: Effect Size', type: 'master' })
    return rows
  }

  const typeColor = { color: '#6366f1', phaser: '#22c55e', master: '#f59e0b' }

  return (
    <div>
      <h2 className={styles.stepTitle}>Free Executor Spaces</h2>
      <p className={styles.stepDesc}>
        Tell the app which page and executor range is free for it to use.
        The app needs <strong style={{ color: '#a5b4fc' }}>{EXECUTORS_NEEDED} consecutive executor slots</strong>.
        It will NEVER touch any executor outside this range.
      </p>

      <div className={styles.card}>
        <div className={styles.row}>
          <div style={{ flex: 1 }}>
            <div className={styles.label}>MA3 Page</div>
            <input
              type="number" min={1} max={100}
              className={styles.input}
              value={page}
              onChange={e => setPage(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div className={styles.label}>Starting Executor</div>
            <input
              type="number" min={1} max={300}
              className={styles.input}
              value={startExec}
              onChange={e => setStart(e.target.value)}
            />
          </div>
          <div style={{ flex: 2, paddingTop: 20 }}>
            <div
              style={{
                padding: '10px 16px',
                background: '#1e1e2e',
                borderRadius: 8,
                fontSize: 13,
                color: '#888',
              }}
            >
              Will use: Page {page}, Exec {startExec} → {endExec}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.label} style={{ marginBottom: 16 }}>Allocation Preview</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {buildPreview().map(row => (
            <div
              key={row.exec}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: '#0a0a0f',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <span style={{ color: '#555', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                P{page} / E{row.exec}
              </span>
              <span
                style={{
                  padding: '2px 6px',
                  background: typeColor[row.type] + '20',
                  color: typeColor[row.type],
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 50,
                }}
              >
                {row.type}
              </span>
              <span style={{ color: '#ccc' }}>{row.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import React from 'react'
import useStore from '../store/appState.js'
import { buildAddressMapFromWizard, getExecutorPlan } from '../osc/addressMap.js'
import styles from './Wizard.module.css'

export default function ExecutorMap() {
  const { session, updateSession } = useStore()
  const page = session.freeExecutorPage ?? 2
  const startExec = session.freeExecutorStart ?? 1
  const phaserConfig = session.phaserConfig || {}
  const allocationPlan = getExecutorPlan({
    fixtureGroups: session.fixtureGroups || [],
    phaserConfig,
  })
  const executorsNeeded = allocationPlan.length
  const endExec = startExec + executorsNeeded - 1

  const updateMap = (nextPage, nextStartExec) => {
    const map = buildAddressMapFromWizard({
      page: nextPage,
      startExec: nextStartExec,
      fixtureGroups: session.fixtureGroups || [],
      phaserConfig,
    })
    updateSession({ addressMap: map })
  }

  const setPage = (v) => {
    const nextPage = Math.max(1, Number(v))
    updateSession({ freeExecutorPage: nextPage })
    updateMap(nextPage, startExec)
  }

  const setStart = (v) => {
    const nextStartExec = Math.max(1, Number(v))
    updateSession({ freeExecutorStart: nextStartExec })
    updateMap(page, nextStartExec)
  }

  const typeColor = { color: '#6366f1', phaser: '#22c55e', master: '#f59e0b' }

  return (
    <div>
      <h2 className={styles.stepTitle}>Free Executor Spaces</h2>
      <p className={styles.stepDesc}>
        Tell the app which page and executor range is free for it to use.
        The app needs <strong style={{ color: '#a5b4fc' }}>{executorsNeeded} consecutive executor slots</strong>
        {' '}for the items shown below.
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
          {allocationPlan.map((row, index) => (
            <div
              key={row.key}
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
                P{page} / E{startExec + index}
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

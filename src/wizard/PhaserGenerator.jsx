import React, { useState } from 'react'
import useStore from '../store/appState.js'
import { generatePhaserPlugin } from '../luagen/generatePhaserPlugin.js'
import { buildAddressMapFromWizard, setAddressMap } from '../osc/addressMap.js'
import styles from './Wizard.module.css'

export default function PhaserGenerator() {
  const { session, updateSession } = useStore()
  const [generated, setGenerated] = useState(false)
  const [luaCode, setLuaCode] = useState('')
  const phaserCfg = session.phaserConfig || {}
  const [includePtFast, setIncludePtFast] = useState(phaserCfg.includePtFast ?? true)
  const [includePanOnly, setIncludePanOnly] = useState(phaserCfg.includePanOnly ?? true)
  const [includeTiltOnly, setIncludeTiltOnly] = useState(phaserCfg.includeTiltOnly ?? true)
  const [ptPreset, setPtPreset] = useState(phaserCfg.ptPreset || '')
  const [panPreset, setPanPreset] = useState(phaserCfg.panPreset || '')
  const [tiltPreset, setTiltPreset] = useState(phaserCfg.tiltPreset || '')

  // Phasers start 1 executor after the shared color look sequence
  const phaserExecStart = (session.freeExecutorStart || 1) + 1

  const generate = () => {
    const code = generatePhaserPlugin({
      fixtureGroups: session.fixtureGroups || [],
      page: session.freeExecutorPage || 2,
      phaserExecStart,
      includePtFast,
      includePanOnly,
      includeTiltOnly,
      ptPreset,
      panPreset,
      tiltPreset,
    })
    const phaserConfig = {
      includePtFast,
      includePanOnly,
      includeTiltOnly,
      ptPreset,
      panPreset,
      tiltPreset,
      switchIntervalMs: 180000,
    }
    const map = buildAddressMapFromWizard({
      page: session.freeExecutorPage || 2,
      startExec: session.freeExecutorStart || 1,
      phaserConfig,
    })
    setAddressMap(map)
    updateSession({ phaserConfig, addressMap: map })

    setLuaCode(code)
    setGenerated(true)
  }

  const download = async () => {
    const result = await window.electronAPI?.fileSave({
      defaultName: 'GMA3_Disco_Pilot_Phasers.lua',
      content: luaCode,
    })
    if (!result?.success) {
      const blob = new Blob([luaCode], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'GMA3_Disco_Pilot_Phasers.lua'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const hasMoverGroups = session.fixtureGroups?.some(g => g.attributes?.pt)
  const hasRgbGroups   = session.fixtureGroups?.some(g => g.attributes?.rgb || g.attributes?.colorWheel)
  let previewExec = phaserExecStart

  const previewRows = []

  if (hasMoverGroups) {
    previewRows.push({ label: 'Pan/Tilt Slow phaser', exec: previewExec })
    previewExec++

    if (includePtFast) {
      previewRows.push({ label: 'Pan/Tilt Fast phaser', exec: previewExec })
      previewExec++
    }

    if (includePanOnly) {
      previewRows.push({ label: 'Pan-only phaser', exec: previewExec })
      previewExec++
    }

    if (includeTiltOnly) {
      previewRows.push({ label: 'Tilt-only phaser', exec: previewExec })
      previewExec++
    }
  }

  if (hasRgbGroups) {
    previewRows.push({ label: 'Color Chase phaser', exec: previewExec })
    previewExec++
  }

  previewRows.push({ label: 'Dimmer Pulse phaser', exec: previewExec })

  return (
    <div>
      <h2 className={styles.stepTitle}>Phaser Setup Plugin</h2>
      <p className={styles.stepDesc}>
        This is a separate plugin that sets up movement and effect phasers in MA3.
        Run it after the main plugin. If phasers look wrong, use MA3's Effect Engine to
        fine-tune them — the app only controls on/off, not the phaser shape itself.
      </p>

      {/* Warning banner */}
      <div className={styles.card} style={{ borderColor: '#92400e', background: '#1c0e00', marginBottom: 20 }}>
        <div className={styles.label} style={{ color: '#f59e0b' }}>
          Test in Offline Mode First
        </div>
        <p style={{ fontSize: 13, color: '#aaa', marginTop: 8, lineHeight: 1.7 }}>
          MA3 v2.x phaser creation commands via LUA are not fully documented.
          The generated script uses the best-known syntax but some commands may need
          manual adjustment in MA3's Effect Engine window after running.
          <br /><br />
          The script includes a <strong style={{ color: '#e0e0e0' }}>step-chase alternative</strong> in
          comments — uncomment it if the Effect Engine approach doesn't work for your setup.
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.label}>What will be created</div>
        <div style={{ display: 'grid', gap: 10, marginTop: 12, marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#aaa' }}>
            <input type="checkbox" checked={includePtFast} onChange={e => setIncludePtFast(e.target.checked)} />
            Include PT Fast
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#aaa' }}>
            <input type="checkbox" checked={includePanOnly} onChange={e => setIncludePanOnly(e.target.checked)} />
            Include Pan-only
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#aaa' }}>
            <input type="checkbox" checked={includeTiltOnly} onChange={e => setIncludeTiltOnly(e.target.checked)} />
            Include Tilt-only
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 16 }}>
          <input className={styles.input} placeholder='P/T preset (e.g. 21.1)' value={ptPreset} onChange={e => setPtPreset(e.target.value)} />
          <input className={styles.input} placeholder='Pan preset (e.g. 21.2)' value={panPreset} onChange={e => setPanPreset(e.target.value)} />
          <input className={styles.input} placeholder='Tilt preset (e.g. 21.3)' value={tiltPreset} onChange={e => setTiltPreset(e.target.value)} />
        </div>
        <ul style={{ fontSize: 13, color: '#aaa', lineHeight: 2, paddingLeft: 20, marginTop: 12 }}>
          {previewRows.map(row => (
            <li key={row.label}>{row.label} — Page {session.freeExecutorPage}, Exec {row.exec}</li>
          ))}
          {!hasMoverGroups && <li style={{ color: '#555' }}>Mover-based phasers — skipped (no mover groups defined)</li>}
          {!hasRgbGroups && <li style={{ color: '#555' }}>Color Chase — skipped (no RGB groups defined)</li>}
        </ul>
        <p style={{ fontSize: 12, color: '#555', marginTop: 12 }}>
          Run the main plugin first, then this phaser plugin, then do OSC + Calibration.
        </p>
      </div>

      {!generated ? (
        <button className={styles.btnPrimary} onClick={generate} style={{ fontSize: 16, padding: '14px 32px' }}>
          Generate Phaser Plugin
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <button className={styles.btnPrimary} onClick={download}>
              ↓ Download GMA3_Disco_Pilot_Phasers.lua
            </button>
            <button className={styles.btnSecondary} onClick={generate}>
              Regenerate
            </button>
          </div>

          <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: '#1e1e2e', borderBottom: '1px solid #2a2a3a', fontSize: 12, color: '#666' }}>
              GMA3_Disco_Pilot_Phasers.lua — preview
            </div>
            <pre style={{
              padding: 16, fontSize: 11, color: '#a5b4fc', overflow: 'auto',
              maxHeight: 280, margin: 0, fontFamily: 'SF Mono, JetBrains Mono, monospace',
            }}>
              {luaCode}
            </pre>
          </div>

          <div className={styles.card} style={{ marginTop: 16, borderColor: '#92400e' }}>
            <div className={styles.label} style={{ color: '#f59e0b' }}>After running — verify in MA3</div>
            <ol style={{ fontSize: 13, color: '#aaa', lineHeight: 2, paddingLeft: 20, marginTop: 12 }}>
              <li>Go to the Sequence view and open <strong style={{ color: '#e0e0e0' }}>DP_PHASER_PT_SLOW</strong></li>
              <li>Check if Cue 1 has an effect on Pan/Tilt in the programmer</li>
              <li>If not: open the <strong style={{ color: '#e0e0e0' }}>Effect Engine</strong> panel and add a Sinus effect to Pan (Width 30, Rate 0.3)</li>
              <li>Store back to the sequence cue</li>
              <li>Repeat for the other phaser sequences</li>
            </ol>
          </div>
        </>
      )}
    </div>
  )
}

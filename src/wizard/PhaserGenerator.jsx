import React, { useMemo, useState } from 'react'
import useStore from '../store/appState.js'
import { generatePhaserPlugin } from '../luagen/generatePhaserPlugin.js'
import { buildAddressMapFromWizard, getExecutorPlan, setAddressMap } from '../osc/addressMap.js'
import styles from './Wizard.module.css'

export default function PhaserGenerator() {
  const { session, updateSession } = useStore()
  const [generated, setGenerated] = useState(false)
  const [luaCode, setLuaCode] = useState('')
  const phaserCfg = session.phaserConfig || {}
  const [includePanOnly, setIncludePanOnly] = useState(phaserCfg.includePanOnly ?? true)
  const [includeTiltOnly, setIncludeTiltOnly] = useState(phaserCfg.includeTiltOnly ?? true)
  const [ptPreset, setPtPreset] = useState(phaserCfg.ptPreset || '')
  const [panPreset, setPanPreset] = useState(phaserCfg.panPreset || '')
  const [tiltPreset, setTiltPreset] = useState(phaserCfg.tiltPreset || '')

  const phaserExecStart = (session.freeExecutorStart || 1) + 1
  const hasMoverGroups = session.fixtureGroups?.some(g => g.attributes?.pt)
  const hasRgbGroups = session.fixtureGroups?.some(g => g.attributes?.rgb || g.attributes?.colorWheel)

  const phaserConfig = useMemo(() => ({
    includePanOnly,
    includeTiltOnly,
    ptPreset,
    panPreset,
    tiltPreset,
    switchIntervalMs: 180000,
  }), [includePanOnly, includeTiltOnly, ptPreset, panPreset, tiltPreset])

  const previewRows = getExecutorPlan({
    fixtureGroups: session.fixtureGroups || [],
    phaserConfig,
  }).filter(row => row.type === 'phaser')

  const generate = () => {
    const code = generatePhaserPlugin({
      fixtureGroups: session.fixtureGroups || [],
      page: session.freeExecutorPage || 2,
      phaserExecStart,
      includePanOnly,
      includeTiltOnly,
      ptPreset,
      panPreset,
      tiltPreset,
    })

    const map = buildAddressMapFromWizard({
      page: session.freeExecutorPage || 2,
      startExec: session.freeExecutorStart || 1,
      fixtureGroups: session.fixtureGroups || [],
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

  return (
    <div>
      <h2 className={styles.stepTitle}>Phaser Setup Plugin</h2>
      <p className={styles.stepDesc}>
        This is a separate plugin that sets up movement and effect phasers in MA3.
        Run it after the main plugin. If phasers look wrong, use MA3&apos;s Effect Engine to
        fine-tune them — the app only controls on/off, not the phaser shape itself.
      </p>

      <div className={styles.card} style={{ borderColor: '#92400e', background: '#1c0e00', marginBottom: 20 }}>
        <div className={styles.label} style={{ color: '#f59e0b' }}>
          Test in Offline Mode First
        </div>
        <p style={{ fontSize: 13, color: '#aaa', marginTop: 8, lineHeight: 1.7 }}>
          MA3 v2.x phaser creation commands via LUA are not fully documented.
          The generated script uses the best-known syntax but some commands may need
          manual adjustment in MA3&apos;s Effect Engine window after running.
          <br /><br />
          The script includes a <strong style={{ color: '#e0e0e0' }}>step-chase alternative</strong> in
          comments — uncomment it if the Effect Engine approach doesn&apos;t work for your setup.
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.label}>What will be created</div>
        <div style={{ display: 'grid', gap: 10, marginTop: 12, marginBottom: 16 }}>
          {hasMoverGroups && (
            <div style={{ fontSize: 13, color: '#aaa' }}>
              The movement setup now uses a single shared <strong style={{ color: '#e0e0e0' }}>Pan/Tilt Circle</strong>
              {' '}instead of separate slow and fast variants.
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#aaa' }}>
            <input type="checkbox" checked={includePanOnly} onChange={e => setIncludePanOnly(e.target.checked)} disabled={!hasMoverGroups} />
            Include Pan-only
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#aaa' }}>
            <input type="checkbox" checked={includeTiltOnly} onChange={e => setIncludeTiltOnly(e.target.checked)} disabled={!hasMoverGroups} />
            Include Tilt-only
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 16 }}>
          <input className={styles.input} placeholder='P/T preset (e.g. 21.1)' value={ptPreset} onChange={e => setPtPreset(e.target.value)} disabled={!hasMoverGroups} />
          <input className={styles.input} placeholder='Pan preset (e.g. 21.2)' value={panPreset} onChange={e => setPanPreset(e.target.value)} disabled={!hasMoverGroups || !includePanOnly} />
          <input className={styles.input} placeholder='Tilt preset (e.g. 21.3)' value={tiltPreset} onChange={e => setTiltPreset(e.target.value)} disabled={!hasMoverGroups || !includeTiltOnly} />
        </div>

        <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          Preview on Page {session.freeExecutorPage || 2}, starting at Exec {phaserExecStart}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {previewRows.map((row, index) => (
            <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#aaa' }}>
              <span>{row.label}</span>
              <span style={{ color: '#22c55e' }}>Exec {phaserExecStart + index}</span>
            </div>
          ))}
          {!hasMoverGroups && !hasRgbGroups && (
            <div style={{ fontSize: 13, color: '#888' }}>
              No movers or color-capable groups are selected yet, so only the global masters will be allocated.
            </div>
          )}
        </div>

        <button className={styles.btnPrimary} style={{ marginTop: 20 }} onClick={generate}>
          Generate Phaser Plugin
        </button>
      </div>

      {generated && (
        <>
          <div className={styles.card} style={{ borderColor: '#166534', marginTop: 20 }}>
            <div className={styles.label} style={{ color: '#22c55e' }}>Plugin Generated</div>
            <p style={{ fontSize: 13, color: '#86efac', marginTop: 8 }}>
              Save this LUA file, import it into MA3, and run it after the main plugin.
            </p>
            <button className={styles.btnPrimary} onClick={download} style={{ marginTop: 16 }}>
              Download LUA File
            </button>
          </div>

          <div className={styles.card} style={{ marginTop: 16 }}>
            <div className={styles.label}>Generated LUA</div>
            <pre
              style={{
                marginTop: 12,
                maxHeight: 360,
                overflow: 'auto',
                background: '#0a0a0f',
                padding: 16,
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.6,
                color: '#a5b4fc',
              }}
            >
              {luaCode}
            </pre>
          </div>

          <div className={styles.card} style={{ marginTop: 16, borderColor: '#92400e' }}>
            <div className={styles.label} style={{ color: '#f59e0b' }}>After running — verify in MA3</div>
            <ol style={{ fontSize: 13, color: '#aaa', lineHeight: 2, paddingLeft: 20, marginTop: 12 }}>
              <li>Go to the Sequence view and open <strong style={{ color: '#e0e0e0' }}>DP_PHASER_PT</strong></li>
              <li>Check if Cue 1 has an effect on Pan/Tilt in the programmer</li>
              <li>If not: open the <strong style={{ color: '#e0e0e0' }}>Effect Engine</strong> panel and add a Sinus effect to Pan/Tilt</li>
              <li>Store back to the sequence cue</li>
              <li>Repeat for the other phaser sequences</li>
            </ol>
          </div>
        </>
      )}
    </div>
  )
}

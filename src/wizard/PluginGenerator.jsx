import React, { useState } from 'react'
import useStore from '../store/appState.js'
import { generatePlugin } from '../luagen/generatePlugin.js'
import styles from './Wizard.module.css'

export default function PluginGenerator() {
  const { session } = useStore()
  const [generated, setGenerated] = useState(false)
  const [luaCode, setLuaCode] = useState('')

  const generate = () => {
    const code = generatePlugin({
      fixtureGroups: session.fixtureGroups,
      avoidColors: session.avoidColors || [],
      emphasizeColors: session.emphasizeColors || [],
      page: session.freeExecutorPage,
      startExec: session.freeExecutorStart,
      selectedPresetRefs: session.selectedPresetRefs || {},
    })
    setLuaCode(code)
    setGenerated(true)
  }

  const download = async () => {
    const result = await window.electronAPI?.fileSave({
      defaultName: 'GMA3_Disco_Pilot_Plugin.lua',
      content: luaCode,
    })
    if (!result?.success) {
      // Fallback: blob download in browser
      const blob = new Blob([luaCode], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'GMA3_Disco_Pilot_Plugin.lua'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  return (
    <div>
      <h2 className={styles.stepTitle}>Generate MA3 Plugin</h2>
      <p className={styles.stepDesc}>
        The app will generate a LUA script based on your fixture groups and preferences.
        Import this file into GrandMA3 as a Plugin and run it once to create all necessary sequences.
      </p>

      {/* Offline test warning */}
      <div className={styles.card} style={{ borderColor: '#92400e', background: '#1c0e00', marginBottom: 20 }}>
        <div className={styles.label} style={{ color: '#f59e0b' }}>
          Run in Offline / Blind Mode First
        </div>
        <p style={{ fontSize: 13, color: '#aaa', marginTop: 8, lineHeight: 1.7 }}>
          This plugin creates sequences and assigns them to executors. It runs in Blind mode
          to avoid affecting your live show during setup. Always test on a non-live system or
          in MA3's offline editor before running at a venue.
          <br /><br />
          Color look sequences use verified MA3 v2.x syntax and should work reliably.
          For phaser sequences, use the separate <strong style={{ color: '#e0e0e0' }}>Phaser Plugin</strong> (next step).
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.label}>What will be created</div>
        <ul style={{ fontSize: 13, color: '#aaa', lineHeight: 2, paddingLeft: 20, marginTop: 12 }}>
          <li>8 color look sequences (one per genre: Techno, EDM, Hip-Hop, Pop, 80s, Latin, Rock, Corporate)</li>
          <li>2 Pan/Tilt phaser sequences (slow + fast), if you have mover groups</li>
          <li>1 color chase phaser</li>
          <li>1 dimmer pulse phaser</li>
          <li>1 BPM Rate Master executor</li>
          <li>1 Effect Size Master executor</li>
        </ul>
        <p style={{ fontSize: 13, color: '#f59e0b', marginTop: 12 }}>
          All sequences will be placed on <strong>Page {session.freeExecutorPage}</strong>,
          Executors {session.freeExecutorStart}–{(session.freeExecutorStart || 1) + 13}.
          Nothing outside this range will be touched.
        </p>
      </div>

      {!generated ? (
        <button className={styles.btnPrimary} onClick={generate} style={{ fontSize: 16, padding: '14px 32px' }}>
          Generate Plugin
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <button className={styles.btnPrimary} onClick={download}>
              ↓ Download .lua file
            </button>
            <button className={styles.btnSecondary} onClick={generate}>
              Regenerate
            </button>
          </div>

          {/* Code preview */}
          <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: '#1e1e2e', borderBottom: '1px solid #2a2a3a', fontSize: 12, color: '#666' }}>
              GMA3_Disco_Pilot_Plugin.lua — preview
            </div>
            <pre
              style={{
                padding: 16,
                fontSize: 11,
                color: '#a5b4fc',
                overflow: 'auto',
                maxHeight: 320,
                margin: 0,
                fontFamily: 'SF Mono, JetBrains Mono, monospace',
              }}
            >
              {luaCode}
            </pre>
          </div>

          <div className={styles.card} style={{ marginTop: 16, borderColor: '#166534' }}>
            <div className={styles.label} style={{ color: '#22c55e' }}>How to import into GrandMA3</div>
            <ol style={{ fontSize: 13, color: '#aaa', lineHeight: 2, paddingLeft: 20, marginTop: 12 }}>
              <li>Copy the downloaded <strong style={{ color: '#e0e0e0' }}>.lua</strong> file to a USB drive or your MA3's shared folder</li>
              <li>In MA3: <strong style={{ color: '#e0e0e0' }}>Menu → Plugins → Import Plugin</strong></li>
              <li>Select the file</li>
              <li>Go to the Plugins view and <strong style={{ color: '#e0e0e0' }}>Run</strong> the plugin</li>
              <li>Check the console's info bar for the success message</li>
            </ol>
          </div>
        </>
      )}
    </div>
  )
}

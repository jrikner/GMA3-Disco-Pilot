import React, { useState } from 'react'
import useStore from '../store/appState.js'
import { generatePlugin } from '../luagen/generatePlugin.js'
import { generatePluginXml } from '../luagen/generatePluginXml.js'
import styles from './Wizard.module.css'

export default function PluginGenerator() {
  const { session } = useStore()
  const [generated, setGenerated] = useState(false)
  const [luaCode, setLuaCode] = useState('')
  const [pluginName, setPluginName] = useState('Disco Pilot Generator')
  const [pluginVersion, setPluginVersion] = useState('1.0.0')
  const [pluginDescription, setPluginDescription] = useState(
    'Creates Disco Pilot color looks and helper executors in MA3.',
  )

  const luaFileName = 'GMA3_Disco_Pilot_Plugin.lua'
  const xmlFileName = 'GMA3_Disco_Pilot_Plugin.xml'

  const xmlCode = generatePluginXml({
    pluginName,
    version: pluginVersion,
    description: pluginDescription,
    luaFileName,
    entryPoint: 'main',
  })

  const generate = () => {
    const code = generatePlugin({
      fixtureGroups: session.fixtureGroups,
      avoidColors: session.avoidColors || [],
      emphasizeColors: session.emphasizeColors || [],
      page: session.freeExecutorPage,
      startExec: session.freeExecutorStart,
    })
    setLuaCode(code)
    setGenerated(true)
  }

  const download = async () => {
    const result = await window.electronAPI?.fileSave({
      defaultName: luaFileName,
      content: luaCode,
      fileType: 'lua',
    })
    if (!result?.success) {
      // Fallback: blob download in browser
      const blob = new Blob([luaCode], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = luaFileName
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const downloadXml = async () => {
    const result = await window.electronAPI?.fileSave({
      defaultName: xmlFileName,
      content: xmlCode,
      fileType: 'xml',
    })
    if (!result?.success) {
      const blob = new Blob([xmlCode], { type: 'application/xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = xmlFileName
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

      <div className={styles.card}>
        <div className={styles.label}>Plugin metadata (for XML export)</div>
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 12, color: '#aaa' }}>
            Plugin Name
            <input
              value={pluginName}
              onChange={(e) => setPluginName(e.target.value)}
              style={{ padding: 10, borderRadius: 8, border: '1px solid #2a2a3a', background: '#101018', color: '#e0e0e0' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 12, color: '#aaa' }}>
            Version
            <input
              value={pluginVersion}
              onChange={(e) => setPluginVersion(e.target.value)}
              style={{ padding: 10, borderRadius: 8, border: '1px solid #2a2a3a', background: '#101018', color: '#e0e0e0' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 12, color: '#aaa' }}>
            Description
            <textarea
              value={pluginDescription}
              onChange={(e) => setPluginDescription(e.target.value)}
              rows={3}
              style={{ padding: 10, borderRadius: 8, border: '1px solid #2a2a3a', background: '#101018', color: '#e0e0e0' }}
            />
          </label>
        </div>
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
            <button className={styles.btnPrimary} onClick={downloadXml}>
              ↓ Download .xml wrapper
            </button>
            <button className={styles.btnSecondary} onClick={generate}>
              Regenerate
            </button>
          </div>

          <p style={{ fontSize: 12, color: '#777', marginTop: -12, marginBottom: 16 }}>
            Bundle/zip export is not currently supported in-app. Export both files and keep them together for MA3 import.
          </p>

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

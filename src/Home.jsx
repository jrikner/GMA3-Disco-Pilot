import React, { useEffect, useState } from 'react'
import useStore from './store/appState.js'

export default function Home() {
  const { setScreen, updateSession } = useStore()
  const [savedProfiles, setSavedProfiles] = useState([])
  const [essentiaPresent, setEssentiaPresent] = useState(null)  // null = checking

  useEffect(() => {
    window.electronAPI?.profileList().then(r => {
      if (r?.success) setSavedProfiles(r.profiles)
    })
    // Check if the browser Essentia runtime bundle is present
    Promise.all([
      fetch('/models/essentia-wasm.es.js', { method: 'HEAD' }),
      fetch('/models/essentia.js-core.es.js', { method: 'HEAD' }),
    ])
      .then(([loader, core]) => setEssentiaPresent(loader.ok && core.ok))
      .catch(() => setEssentiaPresent(false))
  }, [])

  const loadProfile = async (name) => {
    const r = await window.electronAPI?.profileLoad({ name })
    if (r?.success) {
      updateSession({ ...r.data.session, boundaries: r.data.boundaries, addressMap: r.data.addressMap })
      setScreen('dashboard')
    }
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#060608',
        color: '#e0e0e0',
        gap: 40,
        WebkitAppRegion: 'drag',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🎛</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
          GMA3 Disco Pilot
        </h1>
        <p style={{ color: '#555', fontSize: 14 }}>
          AI-driven music genre lighting controller for GrandMA3
        </p>
      </div>

      <div style={{ display: 'flex', gap: 16, WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={() => setScreen('wizard')}
          style={{
            padding: '14px 32px',
            background: '#6366f1',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          New Session
        </button>

        {savedProfiles.length > 0 && (
          <div style={{ position: 'relative' }}>
            <select
              onChange={e => e.target.value && loadProfile(e.target.value)}
              style={{
                padding: '14px 32px',
                background: '#12121a',
                color: '#ccc',
                border: '1px solid #2a2a3a',
                borderRadius: 10,
                fontSize: 15,
                cursor: 'pointer',
                appearance: 'none',
              }}
            >
              <option value="">Load saved profile…</option>
              {savedProfiles.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {essentiaPresent === false && (
        <div style={{
          maxWidth: 480, padding: '12px 16px',
          background: '#1c1200', border: '1px solid #92400e', borderRadius: 10,
          fontSize: 12, color: '#aaa', lineHeight: 1.7,
          WebkitAppRegion: 'no-drag',
        }}>
          <strong style={{ color: '#f59e0b' }}>Genre detection unavailable.</strong>
          <br />
          Run <code style={{ color: '#e0e0e0', background: '#2a1a00', padding: '1px 5px', borderRadius: 3 }}>npm run setup:models</code> to copy the Essentia browser runtime and download the official Discogs-MAEST metadata. Then copy a TensorFlow.js MAEST export into{' '}
          <code style={{ color: '#e0e0e0', background: '#2a1a00', padding: '1px 5px', borderRadius: 3 }}>
            public/models/
          </code>{' '}
          or generate one from the official frozen graph with <code style={{ color: '#e0e0e0', background: '#2a1a00', padding: '1px 5px', borderRadius: 3 }}>npm run convert:maest -- /path/to/model.pb /path/to/model.json</code>.
          See <code>public/models/README.md</code> for instructions.
        </div>
      )}

      <p style={{ fontSize: 12, color: '#333' }}>
        First time? Start with New Session to configure your MA3 show and generate the plugin.
      </p>
    </div>
  )
}

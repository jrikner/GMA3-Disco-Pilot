import React, { useEffect, useState } from 'react'
import useStore from './store/appState.js'

export default function Home() {
  const { setScreen, updateSession } = useStore()
  const [savedProfiles, setSavedProfiles] = useState([])

  useEffect(() => {
    window.electronAPI?.profileList().then(r => {
      if (r?.success) setSavedProfiles(r.profiles)
    })
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

      <p style={{ fontSize: 12, color: '#333' }}>
        First time? Start with New Session to configure your MA3 show and generate the plugin.
      </p>
    </div>
  )
}

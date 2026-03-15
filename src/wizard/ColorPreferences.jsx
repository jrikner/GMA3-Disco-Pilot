import React, { useState } from 'react'
import useStore from '../store/appState.js'
import styles from './Wizard.module.css'

const PRESET_AVOID = [
  { label: 'Red',        h: 0,   s: 90, l: 50 },
  { label: 'Green',      h: 120, s: 80, l: 40 },
  { label: 'Blue',       h: 220, s: 90, l: 50 },
  { label: 'Yellow',     h: 55,  s: 90, l: 55 },
  { label: 'Magenta',    h: 300, s: 85, l: 50 },
  { label: 'Cyan',       h: 185, s: 85, l: 50 },
]

const PRESET_EMPHASIZE = [
  { label: 'Warm White', h: 40,  s: 20, l: 80 },
  { label: 'Gold',       h: 45,  s: 80, l: 55 },
  { label: 'Purple',     h: 270, s: 70, l: 45 },
  { label: 'Teal',       h: 175, s: 70, l: 45 },
  { label: 'Pink',       h: 320, s: 75, l: 60 },
  { label: 'Orange',     h: 25,  s: 90, l: 55 },
]

function ColorSwatch({ color, onRemove }) {
  const { h, s, l, label } = color
  return (
    <div className={styles.tag}>
      <span
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: `hsl(${h}, ${s}%, ${l}%)`,
          flexShrink: 0,
        }}
      />
      {label}
      {onRemove && <button onClick={onRemove}>✕</button>}
    </div>
  )
}

export default function ColorPreferences() {
  const { session, updateSession } = useStore()
  const [customHue, setCustomHue] = useState(200)
  const [customLabel, setCustomLabel] = useState('')

  const avoidColors = session.avoidColors || []
  const emphasizeColors = session.emphasizeColors || []

  const addAvoid = (color) => {
    if (avoidColors.find(c => c.label === color.label)) return
    updateSession({ avoidColors: [...avoidColors, color] })
  }

  const removeAvoid = (label) => {
    updateSession({ avoidColors: avoidColors.filter(c => c.label !== label) })
  }

  const addEmphasize = (color) => {
    if (emphasizeColors.find(c => c.label === color.label)) return
    updateSession({ emphasizeColors: [...emphasizeColors, color] })
  }

  const removeEmphasize = (label) => {
    updateSession({ emphasizeColors: emphasizeColors.filter(c => c.label !== label) })
  }

  const addCustomAvoid = () => {
    if (!customLabel.trim()) return
    addAvoid({ h: customHue, s: 80, l: 50, label: customLabel.trim() })
    setCustomLabel('')
  }

  return (
    <div>
      <h2 className={styles.stepTitle}>Color Preferences</h2>
      <p className={styles.stepDesc}>
        Set any color restrictions for tonight. For example, avoid red at a corporate event,
        or emphasize a brand color. These are applied as hard constraints in the generated MA3 plugin.
      </p>

      <div className={styles.card}>
        <div className={styles.label}>Colors to AVOID</div>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
          These colors won't appear in the generated lighting sequences.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {PRESET_AVOID.map(c => (
            <button
              key={c.label}
              onClick={() => addAvoid(c)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', background: '#1e1e2e',
                border: `1px solid ${avoidColors.find(a => a.label === c.label) ? '#ef4444' : '#2a2a3a'}`,
                borderRadius: 20, cursor: 'pointer', color: '#ccc', fontSize: 12,
              }}
            >
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: `hsl(${c.h},${c.s}%,${c.l}%)` }} />
              {c.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {avoidColors.map(c => (
            <ColorSwatch key={c.label} color={c} onRemove={() => removeAvoid(c.label)} />
          ))}
        </div>

        {/* Custom color picker */}
        <div className={styles.row} style={{ marginTop: 16 }}>
          <div>
            <div className={styles.label}>Custom hue</div>
            <input
              type="range" min={0} max={360}
              value={customHue}
              onChange={e => setCustomHue(Number(e.target.value))}
              style={{ width: 120, accentColor: `hsl(${customHue}, 80%, 50%)` }}
            />
            <span
              style={{
                display: 'inline-block', width: 20, height: 20,
                borderRadius: '50%', background: `hsl(${customHue}, 80%, 50%)`,
                marginLeft: 8, verticalAlign: 'middle',
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div className={styles.label}>Label</div>
            <input
              className={styles.input}
              placeholder="e.g. Company blue"
              value={customLabel}
              onChange={e => setCustomLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomAvoid()}
            />
          </div>
          <button
            className={styles.btnPrimary}
            style={{ marginTop: 18, padding: '8px 16px' }}
            onClick={addCustomAvoid}
          >
            Add
          </button>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.label}>Colors to EMPHASIZE</div>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
          These colors will be prioritized in the generated sequences where possible.
          Great for brand colors or event themes.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {PRESET_EMPHASIZE.map(c => (
            <button
              key={c.label}
              onClick={() => addEmphasize(c)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', background: '#1e1e2e',
                border: `1px solid ${emphasizeColors.find(a => a.label === c.label) ? '#22c55e' : '#2a2a3a'}`,
                borderRadius: 20, cursor: 'pointer', color: '#ccc', fontSize: 12,
              }}
            >
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: `hsl(${c.h},${c.s}%,${c.l}%)` }} />
              {c.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {emphasizeColors.map(c => (
            <ColorSwatch key={c.label} color={c} onRemove={() => removeEmphasize(c.label)} />
          ))}
        </div>
      </div>
    </div>
  )
}

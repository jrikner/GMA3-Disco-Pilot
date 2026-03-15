import React from 'react'
import useStore from '../store/appState.js'
import styles from './Wizard.module.css'

const PRESET_FIELDS = [
  { key: 'ptSlow', label: 'P/T Slow', hint: 'e.g. 2.101 or "Preset 2.101"' },
  { key: 'ptFast', label: 'P/T Fast', hint: 'e.g. 2.102' },
  { key: 'colorChase', label: 'Color Chase', hint: 'e.g. 4.12 (optional color base)' },
  { key: 'dimPulse', label: 'Dim Pulse', hint: 'e.g. 1.5 (optional dimmer base)' },
]

export default function PositionPresetContext() {
  const { session, updateSession } = useStore()
  const refs = session.selectedPresetRefs || {}

  const updateRef = (key, value) => {
    updateSession({
      selectedPresetRefs: {
        ...refs,
        [key]: value,
      },
    })
  }

  const clearAll = () => {
    updateSession({
      selectedPresetRefs: { ptSlow: '', ptFast: '', colorChase: '', dimPulse: '' },
    })
  }

  return (
    <div>
      <h2 className={styles.stepTitle}>Showfile Preset Context</h2>
      <p className={styles.stepDesc}>
        Optional: reference existing MA3 presets from your showfile. If set, generated movement/phaser
        commands apply these presets before Disco Pilot effect recipes.
      </p>

      <div className={styles.card}>
        <div className={styles.label}>Preset references</div>
        <p style={{ fontSize: 12, color: '#777', marginTop: 8 }}>
          Use native MA3 references (for example: <code>2.101</code> or <code>Preset 2.101</code>).
          Leave blank to use default generated values only.
        </p>

        <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
          {PRESET_FIELDS.map((field) => (
            <div key={field.key}>
              <div className={styles.label} style={{ marginBottom: 6 }}>{field.label}</div>
              <input
                className={styles.input}
                value={refs[field.key] || ''}
                placeholder={field.hint}
                onChange={(e) => updateRef(field.key, e.target.value.trim())}
              />
            </div>
          ))}
        </div>

        <button className={styles.btnSecondary} onClick={clearAll} style={{ marginTop: 14 }}>
          Clear preset references
        </button>
      </div>
    </div>
  )
}

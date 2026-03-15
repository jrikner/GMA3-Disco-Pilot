import React from 'react'
import useStore from '../store/appState.js'
import { TONIGHT_CONTEXTS } from '../profiles/genreProfiles.js'
import styles from './Wizard.module.css'

const CONTEXT_ICONS = {
  edm:       '⚡',
  techno:    '🖤',
  hiphop:    '🎤',
  pop:       '✨',
  eighties:  '🕹️',
  latin:     '🌶️',
  rock:      '🎸',
  corporate: '🏢',
}

export default function GenreContext() {
  const { session, updateSession } = useStore()
  const selected = session.tonightContexts || []

  const toggle = (id) => {
    const next = selected.includes(id)
      ? selected.filter(s => s !== id)
      : [...selected, id]
    updateSession({ tonightContexts: next })
  }

  return (
    <div>
      <h2 className={styles.stepTitle}>Tonight's Context</h2>
      <p className={styles.stepDesc}>
        Select one or more genres that describe tonight's event.
        The AI will heavily favour these genres when classifying music,
        reducing false positives and improving response time.
        You can change this during the show from the dashboard.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {TONIGHT_CONTEXTS.map(ctx => {
          const isSelected = selected.includes(ctx.id)
          return (
            <button
              key={ctx.id}
              onClick={() => toggle(ctx.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '16px 20px',
                background: isSelected ? '#1e1e3a' : '#12121a',
                border: `2px solid ${isSelected ? '#6366f1' : '#1e1e2e'}`,
                borderRadius: 12,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s',
              }}
            >
              <span style={{ fontSize: 24 }}>{CONTEXT_ICONS[ctx.id]}</span>
              <span style={{ color: isSelected ? '#a5b4fc' : '#ccc', fontSize: 14, fontWeight: isSelected ? 600 : 400 }}>
                {ctx.label}
              </span>
              {isSelected && (
                <span style={{ marginLeft: 'auto', color: '#6366f1', fontSize: 16 }}>✓</span>
              )}
            </button>
          )
        })}
      </div>

      {selected.length === 0 && (
        <p style={{ marginTop: 24, color: '#666', fontSize: 13 }}>
          No context selected — the AI will consider all genres equally.
          This works fine but may respond more slowly to unusual mixes.
        </p>
      )}
    </div>
  )
}

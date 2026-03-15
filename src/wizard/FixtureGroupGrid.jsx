import React from 'react'
import useStore from '../store/appState.js'
import styles from './Wizard.module.css'

const FIXTURE_TYPES = [
  'Moving Head (Beam)', 'Moving Head (Spot)', 'Moving Head (Wash)',
  'LED PAR', 'LED Bar / Batten', 'Strobe', 'Blinder', 'Other',
]

const ATTRIBUTES = [
  { key: 'pt',         label: 'Pan / Tilt' },
  { key: 'rgb',        label: 'RGB' },
  { key: 'colorWheel', label: 'Color Wheel' },
  { key: 'strobe',     label: 'Strobe Channel' },
  { key: 'dimmer',     label: 'Dimmer' },
  { key: 'zoom',       label: 'Zoom / Iris' },
  { key: 'gobo',       label: 'Gobo Wheel' },
]

const emptyGroup = () => ({
  id: Date.now() + Math.random(),
  name: '',
  fixtureType: FIXTURE_TYPES[0],
  maGroupName: '',
  attributes: { pt: false, rgb: false, colorWheel: false, strobe: false, dimmer: true, zoom: false, gobo: false },
})

export default function FixtureGroupGrid() {
  const { session, updateSession } = useStore()
  const groups = session.fixtureGroups.length > 0
    ? session.fixtureGroups
    : [emptyGroup()]

  const update = (id, field, value) => {
    updateSession({
      fixtureGroups: groups.map(g =>
        g.id === id ? { ...g, [field]: value } : g
      ),
    })
  }

  const updateAttr = (id, attrKey, value) => {
    updateSession({
      fixtureGroups: groups.map(g =>
        g.id === id ? { ...g, attributes: { ...g.attributes, [attrKey]: value } } : g
      ),
    })
  }

  const addGroup = () => {
    updateSession({ fixtureGroups: [...groups, emptyGroup()] })
  }

  const removeGroup = (id) => {
    updateSession({ fixtureGroups: groups.filter(g => g.id !== id) })
  }

  return (
    <div>
      <h2 className={styles.stepTitle}>Fixture Groups</h2>
      <p className={styles.stepDesc}>
        Add a row for each fixture group in your GrandMA3 show.
        Enter the group name exactly as it appears in MA3, choose the fixture type,
        and check which attributes the fixtures in that group have.
      </p>

      {/* Session name — ask first so the profile can be saved at the end */}
      <div className={styles.card} style={{ marginBottom: 24 }}>
        <div className={styles.label}>Session Name</div>
        <input
          className={styles.input}
          placeholder="e.g. Friday Club Night"
          value={session.name || ''}
          onChange={e => updateSession({ name: e.target.value })}
          style={{ maxWidth: 380 }}
        />
        <p style={{ fontSize: 12, color: '#555', marginTop: 8 }}>
          Used when saving this profile — you can reuse it next time to skip the wizard.
        </p>
      </div>

      {groups.map((group, idx) => (
        <div key={group.id} className={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontWeight: 600, color: '#a5b4fc' }}>Group {idx + 1}</span>
            {groups.length > 1 && (
              <button className={styles.deleteBtn} onClick={() => removeGroup(group.id)}>✕</button>
            )}
          </div>

          <div className={styles.row}>
            <div style={{ flex: 2 }}>
              <div className={styles.label}>MA3 Group Name / Number</div>
              <input
                className={styles.input}
                placeholder="e.g. Moving Heads or Group 3"
                value={group.maGroupName}
                onChange={e => update(group.id, 'maGroupName', e.target.value)}
              />
            </div>
            <div style={{ flex: 2 }}>
              <div className={styles.label}>Friendly Name</div>
              <input
                className={styles.input}
                placeholder="e.g. Stage movers"
                value={group.name}
                onChange={e => update(group.id, 'name', e.target.value)}
              />
            </div>
            <div style={{ flex: 2 }}>
              <div className={styles.label}>Fixture Type</div>
              <select
                className={styles.input}
                value={group.fixtureType}
                onChange={e => update(group.id, 'fixtureType', e.target.value)}
                style={{ cursor: 'pointer' }}
              >
                {FIXTURE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className={styles.label} style={{ marginTop: 16 }}>Available Attributes</div>
          <div className={styles.checkboxRow}>
            {ATTRIBUTES.map(attr => (
              <label key={attr.key} className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={!!group.attributes[attr.key]}
                  onChange={e => updateAttr(group.id, attr.key, e.target.checked)}
                />
                {attr.label}
              </label>
            ))}
          </div>
        </div>
      ))}

      <button className={styles.addBtn} onClick={addGroup}>
        + Add Fixture Group
      </button>
    </div>
  )
}

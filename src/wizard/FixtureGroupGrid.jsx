import React, { useState } from 'react'
import useStore from '../store/appState.js'
import styles from './Wizard.module.css'
import {
  getDefaultCapabilities,
  getFixtureProfile,
  searchFixtureDefinitions,
} from '../fixtures/gdtfService.js'

const FIXTURE_TYPES = [
  'Moving Head (Beam)', 'Moving Head (Spot)', 'Moving Head (Wash)',
  'LED PAR', 'LED Bar / Batten', 'Strobe', 'Blinder', 'Other',
]

const BASE_ATTRIBUTES = {
  pt: false,
  rgb: false,
  colorWheel: false,
  strobe: false,
  dimmer: true,
  zoom: false,
  gobo: false,
}

const FIXTURE_TYPE_DEFAULTS = {
  'Moving Head (Beam)': { ...BASE_ATTRIBUTES, pt: true, colorWheel: true, strobe: true, dimmer: true, gobo: true },
  'Moving Head (Spot)': { ...BASE_ATTRIBUTES, pt: true, colorWheel: true, strobe: true, dimmer: true, zoom: true, gobo: true },
  'Moving Head (Wash)': { ...BASE_ATTRIBUTES, pt: true, rgb: true, strobe: true, dimmer: true, zoom: true },
  'LED PAR': { ...BASE_ATTRIBUTES, rgb: true, strobe: true, dimmer: true },
  'LED Bar / Batten': { ...BASE_ATTRIBUTES, rgb: true, strobe: true, dimmer: true },
  'Strobe': { ...BASE_ATTRIBUTES, strobe: true, dimmer: true },
  'Blinder': { ...BASE_ATTRIBUTES, dimmer: true, strobe: true },
  'Other': { ...BASE_ATTRIBUTES, dimmer: true },
}

const ATTRIBUTES = [
  { key: 'pt',         label: 'Pan / Tilt' },
  { key: 'rgb',        label: 'RGB' },
  { key: 'colorWheel', label: 'Color Wheel' },
  { key: 'strobe',     label: 'Strobe Channel' },
  { key: 'dimmer',     label: 'Dimmer' },
  { key: 'zoom',       label: 'Zoom / Iris' },
  { key: 'gobo',       label: 'Gobo Wheel' },
]

const getDefaultAttributes = (fixtureType) => ({
  ...BASE_ATTRIBUTES,
  ...(FIXTURE_TYPE_DEFAULTS[fixtureType] || FIXTURE_TYPE_DEFAULTS.Other),
})

const emptyGroup = () => ({
  id: Date.now() + Math.random(),
  fixtureType: FIXTURE_TYPES[0],
  maGroupName: '',
  attributes: getDefaultAttributes(FIXTURE_TYPES[0]),
})

export default function FixtureGroupGrid() {
  const { session, updateSession } = useStore()
  const [profileUiState, setProfileUiState] = useState({})

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
        g.id === id
          ? { ...g, attributesCustomized: true, attributes: { ...g.attributes, [attrKey]: value } }
          : g
      ),
    })
  }

  const updateProfileState = (id, patch) => {
    setProfileUiState((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...patch },
    }))
  }

  const searchProfiles = async (group) => {
    const state = profileUiState[group.id] || {}
    const query = state.query || group.maGroupName || group.fixtureType

    updateProfileState(group.id, { loading: true, error: '', results: [] })
    const results = await searchFixtureDefinitions({ query })

    if (results.length === 0) {
      updateProfileState(group.id, {
        loading: false,
        results: [],
        error: 'No online profiles found. You can continue with manual type and attributes.',
      })
      return
    }

    updateProfileState(group.id, {
      loading: false,
      error: '',
      results,
      selectedProfileId: results[0].id,
      selectedModeName: results[0].modes?.[0]?.name || '',
    })
  }

  const updateFixtureType = (id, fixtureType) => {
    const defaults = getDefaultAttributes(fixtureType)
    updateSession({
      fixtureGroups: groups.map((g) => {
        if (g.id !== id) return g
        return {
          ...g,
          fixtureType,
          attributes: g.attributesCustomized ? g.attributes : defaults,
        }
      }),
    })
  }

  const importSelectedProfile = async (group) => {
    const state = profileUiState[group.id] || {}
    if (!state.selectedProfileId) return

    const profileSummary = (state.results || []).find(r => r.id === state.selectedProfileId)
    if (!profileSummary) return

    updateProfileState(group.id, { importing: true, error: '' })
    const profile = await getFixtureProfile(profileSummary, state.selectedModeName)

    if (!profile) {
      updateProfileState(group.id, {
        importing: false,
        error: 'Could not download this profile right now. Manual workflow is still available.',
      })
      return
    }

    updateSession({
      fixtureGroups: groups.map(g =>
        g.id === group.id
          ? {
              ...g,
              fixtureType: profile.fixtureType || g.fixtureType,
              attributes: {
                ...getDefaultCapabilities(),
                ...(profile.capabilities || {}),
              },
            }
          : g
      ),
    })

    updateProfileState(group.id, {
      importing: false,
      importedLabel: `${profile.manufacturer} ${profile.model}${profile.selectedModeName ? ` (${profile.selectedModeName})` : ''}`,
      modes: profile.modes || [],
      selectedModeName: profile.selectedModeName || '',
      error: '',
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

      {groups.map((group, idx) => {
        const rowState = profileUiState[group.id] || {}

        return (
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
                <div className={styles.label}>Fixture Type</div>
                <select
                  className={styles.input}
                  value={group.fixtureType}
                  onChange={e => updateFixtureType(group.id, e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  {FIXTURE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className={styles.label}>Select fixture profile (optional)</div>
              <div className={styles.row}>
                <div style={{ flex: 3 }}>
                  <input
                    className={styles.input}
                    placeholder="Search manufacturer / model / mode"
                    value={rowState.query || ''}
                    onChange={(e) => updateProfileState(group.id, { query: e.target.value })}
                  />
                </div>
                <div>
                  <button className={styles.addBtn} style={{ marginTop: 0 }} onClick={() => searchProfiles(group)}>
                    {rowState.loading ? 'Searching…' : 'Search Profiles'}
                  </button>
                </div>
              </div>

              {rowState.results?.length > 0 && (
                <div className={styles.row} style={{ marginTop: 8 }}>
                  <div style={{ flex: 3 }}>
                    <select
                      className={styles.input}
                      value={rowState.selectedProfileId || ''}
                      onChange={(e) => {
                        const selected = rowState.results.find(r => r.id === e.target.value)
                        updateProfileState(group.id, {
                          selectedProfileId: e.target.value,
                          selectedModeName: selected?.modes?.[0]?.name || '',
                        })
                      }}
                    >
                      {rowState.results.map((result) => (
                        <option key={result.id} value={result.id}>
                          {result.manufacturer} — {result.model}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 2 }}>
                    <input
                      className={styles.input}
                      placeholder="Mode name (optional)"
                      value={rowState.selectedModeName || ''}
                      onChange={(e) => updateProfileState(group.id, { selectedModeName: e.target.value })}
                    />
                  </div>
                  <div>
                    <button className={styles.addBtn} style={{ marginTop: 0 }} onClick={() => importSelectedProfile(group)}>
                      {rowState.importing ? 'Importing…' : 'Import'}
                    </button>
                  </div>
                </div>
              )}

              {rowState.importedLabel && (
                <p style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
                  Imported profile: {rowState.importedLabel}
                </p>
              )}

              {rowState.error && (
                <p style={{ marginTop: 8, fontSize: 12, color: '#fca5a5' }}>
                  {rowState.error}
                </p>
              )}
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
        )
      })}

      <button className={styles.addBtn} onClick={addGroup}>
        + Add Fixture Group
      </button>
    </div>
  )
}

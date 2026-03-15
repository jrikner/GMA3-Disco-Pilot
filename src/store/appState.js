/**
 * Global app state via Zustand.
 *
 * Sections:
 *   - app:     current screen (wizard | dashboard)
 *   - session: tonight's config (fixture groups, color prefs, context)
 *   - osc:     connection status
 *   - live:    real-time audio/genre/BPM values
 *   - overrides: manual operator overrides
 */

import { create } from 'zustand'

const useStore = create((set, get) => ({
  // ── App navigation ──────────────────────────────────────────────────────────
  screen: 'home',  // 'home' | 'wizard' | 'dashboard'
  wizardStep: 0,

  setScreen: (screen) => set({ screen }),
  setWizardStep: (step) => set({ wizardStep: step }),

  // ── Session config (set during wizard) ─────────────────────────────────────
  session: {
    name: '',
    fixtureGroups: [],      // [{ fixtureType, attributes: {pt, rgb, colorWheel, strobe, dimmer, zoom} }]
    avoidColors: [],        // [{ h, s, l, label }]
    emphasizeColors: [],    // [{ h, s, l, label }]
    tonightContexts: [],    // ['edm', 'hiphop', ...]
    freeExecutorPage: 2,
    freeExecutorStart: 1,
    addressMap: null,       // built after wizard
    boundaries: {},         // key: `${page}_${exec}` → { min, max }
    phaserConfig: {
      includePtFast: true,
      includePanOnly: true,
      includeTiltOnly: true,
      ptPreset: '',
      panPreset: '',
      tiltPreset: '',
      switchIntervalMs: 180000,
    },
  },

  updateSession: (patch) => set((s) => ({
    session: { ...s.session, ...patch },
  })),

  // ── OSC connection ──────────────────────────────────────────────────────────
  osc: {
    connected: false,
    host: '192.168.1.100',
    port: 8000,
    lastMessage: null,
    lastError: null,
  },

  updateOsc: (patch) => set((s) => ({ osc: { ...s.osc, ...patch } })),

  // ── Live audio state ────────────────────────────────────────────────────────
  live: {
    bpm: 0,
    energy: 0,
    spectralCentroid: 0,
    isSilent: true,
    isCapturing: false,
    genre: 'unknown',
    genreConfidence: 0,
    topGenres: [],        // [{ genre, score }] top 3
  },

  updateLive: (patch) => set((s) => ({ live: { ...s.live, ...patch } })),

  // ── Operator overrides ──────────────────────────────────────────────────────
  overrides: {
    lockedGenre: null,          // null = auto
    disabledPhasers: {},        // { ptSlow: false, ptFast: false, ... }
    manualBpm: null,            // null = auto
    blackout: false,
    killStrobe: false,
    holdFreeze: false,          // Lock everything, stop automation
  },

  setLockedGenre: (genre) => set((s) => ({
    overrides: { ...s.overrides, lockedGenre: genre },
  })),
  clearLockedGenre: () => set((s) => ({
    overrides: { ...s.overrides, lockedGenre: null },
  })),
  setManualBpm: (bpm) => set((s) => ({
    overrides: { ...s.overrides, manualBpm: bpm },
  })),
  clearManualBpm: () => set((s) => ({
    overrides: { ...s.overrides, manualBpm: null },
  })),
  togglePhaser: (key) => set((s) => ({
    overrides: {
      ...s.overrides,
      disabledPhasers: {
        ...s.overrides.disabledPhasers,
        [key]: !s.overrides.disabledPhasers[key],
      },
    },
  })),
  setBlackout: (val) => set((s) => ({
    overrides: { ...s.overrides, blackout: val },
  })),
  setKillStrobe: (val) => set((s) => ({
    overrides: { ...s.overrides, killStrobe: val },
  })),
  setHoldFreeze: (val) => set((s) => ({
    overrides: { ...s.overrides, holdFreeze: val },
  })),

  // ── Audio device ─────────────────────────────────────────────────────────────
  audioDeviceId: null,
  setAudioDeviceId: (id) => set({ audioDeviceId: id }),

  // ── Session history ──────────────────────────────────────────────────────────
  history: [],  // [{ ts, genre, bpm, confidence }]
  appendHistory: (entry) => set((s) => ({ history: [...s.history, entry] })),
  clearHistory: () => set({ history: [] }),

  // ── Panic presets config ─────────────────────────────────────────────────────
  panicConfig: {
    houseDefaultExec: null,  // { page, exec } — set in session if configured
  },
  setPanicConfig: (patch) => set((s) => ({ panicConfig: { ...s.panicConfig, ...patch } })),
}))

export default useStore

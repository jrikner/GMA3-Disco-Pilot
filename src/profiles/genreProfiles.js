/**
 * Genre Lighting Profiles
 *
 * Each profile defines normalized parameters (0–1) that the profile mapper
 * translates into OSC fader values within the user's calibrated boundaries.
 *
 * Parameters:
 *   colorTemp       - 0 = cold white/blue, 1 = warm amber/red
 *   saturation      - 0 = pastel/white, 1 = full saturated
 *   movementSpeed   - 0 = static, 1 = maximum speed phaser
 *   effectSize      - 0 = subtle, 1 = maximum amplitude effect
 *   strobeEnabled   - whether strobe is allowed for this genre
 *   strobeIntensity - strobe intensity (0–1), only used if strobeEnabled
 *   phasers         - which phasers to activate: ptSlow, panOnly, tiltOnly, colorChase, dimPulse
 *   bpmTracking     - whether to follow detected BPM for rate master
 *   transitionTime  - seconds for crossfade when switching TO this genre
 *
 * colorPalette      - HSL hints for color look (used by LUA generator)
 *   colors: array of { h, s, l } (0–360, 0–100, 0–100)
 */

export const GENRE_PROFILES = {
  techno: {
    label: 'Techno',
    colorTemp: 0.1,       // Cold
    saturation: 0.9,
    movementSpeed: 0.85,
    effectSize: 0.8,
    strobeEnabled: true,
    strobeIntensity: 0.7,
    phasers: { ptSlow: true, colorChase: false, dimPulse: true },
    bpmTracking: true,
    transitionTime: 1.0,
    colorPalette: {
      colors: [
        { h: 220, s: 80, l: 50 },  // Deep blue
        { h: 200, s: 70, l: 60 },  // Cyan
        { h: 0,   s: 0,  l: 95 },  // Near white strobe
      ],
    },
  },

  edm: {
    label: 'EDM / House',
    colorTemp: 0.2,
    saturation: 1.0,
    movementSpeed: 0.75,
    effectSize: 0.75,
    strobeEnabled: true,
    strobeIntensity: 0.5,
    phasers: { ptSlow: true, colorChase: true, dimPulse: true },
    bpmTracking: true,
    transitionTime: 1.5,
    colorPalette: {
      colors: [
        { h: 280, s: 90, l: 50 },  // Purple
        { h: 180, s: 90, l: 50 },  // Cyan
        { h: 60,  s: 90, l: 50 },  // Yellow
      ],
    },
  },

  hiphop: {
    label: 'Hip-Hop / R&B',
    colorTemp: 0.75,
    saturation: 0.7,
    movementSpeed: 0.25,
    effectSize: 0.5,
    strobeEnabled: false,
    strobeIntensity: 0,
    phasers: { ptSlow: true, colorChase: false, dimPulse: false },
    bpmTracking: true,
    transitionTime: 2.0,
    colorPalette: {
      colors: [
        { h: 270, s: 70, l: 35 },  // Deep purple
        { h: 35,  s: 80, l: 55 },  // Gold/amber
        { h: 0,   s: 0,  l: 15 },  // Dark
      ],
    },
  },

  pop: {
    label: 'Pop / Dance',
    colorTemp: 0.5,
    saturation: 0.85,
    movementSpeed: 0.55,
    effectSize: 0.6,
    strobeEnabled: false,
    strobeIntensity: 0,
    phasers: { ptSlow: false, colorChase: true, dimPulse: false },
    bpmTracking: true,
    transitionTime: 1.5,
    colorPalette: {
      colors: [
        { h: 320, s: 80, l: 60 },  // Pink
        { h: 200, s: 80, l: 60 },  // Sky blue
        { h: 140, s: 70, l: 55 },  // Green
        { h: 50,  s: 90, l: 60 },  // Yellow
      ],
    },
  },

  eighties: {
    label: '80s / New Wave',
    colorTemp: 0.4,
    saturation: 0.95,
    movementSpeed: 0.5,
    effectSize: 0.55,
    strobeEnabled: false,
    strobeIntensity: 0,
    phasers: { ptSlow: false, colorChase: true, dimPulse: true },
    bpmTracking: true,
    transitionTime: 2.0,
    colorPalette: {
      colors: [
        { h: 300, s: 90, l: 55 },  // Magenta
        { h: 185, s: 85, l: 55 },  // Cyan
        { h: 45,  s: 95, l: 55 },  // Gold
      ],
    },
  },

  latin: {
    label: 'Latin / Afrobeats',
    colorTemp: 0.65,
    saturation: 0.85,
    movementSpeed: 0.6,
    effectSize: 0.6,
    strobeEnabled: false,
    strobeIntensity: 0,
    phasers: { ptSlow: true, colorChase: true, dimPulse: false },
    bpmTracking: true,
    transitionTime: 2.0,
    colorPalette: {
      colors: [
        { h: 25,  s: 90, l: 55 },  // Orange
        { h: 130, s: 70, l: 45 },  // Green
        { h: 45,  s: 85, l: 60 },  // Yellow-gold
      ],
    },
  },

  rock: {
    label: 'Rock',
    colorTemp: 0.15,
    saturation: 0.8,
    movementSpeed: 0.7,
    effectSize: 0.7,
    strobeEnabled: true,
    strobeIntensity: 0.4,
    phasers: { ptSlow: true, colorChase: false, dimPulse: true },
    bpmTracking: true,
    transitionTime: 1.0,
    colorPalette: {
      colors: [
        { h: 0,   s: 90, l: 50 },  // Red
        { h: 220, s: 80, l: 45 },  // Blue
        { h: 0,   s: 0,  l: 90 },  // White
      ],
    },
  },

  corporate: {
    label: 'Corporate / Ambient',
    colorTemp: 0.6,
    saturation: 0.2,
    movementSpeed: 0.05,
    effectSize: 0.15,
    strobeEnabled: false,
    strobeIntensity: 0,
    phasers: { ptSlow: false, colorChase: false, dimPulse: false },
    bpmTracking: false,
    transitionTime: 4.0,
    colorPalette: {
      colors: [
        { h: 40,  s: 20, l: 80 },  // Warm white
        { h: 210, s: 15, l: 75 },  // Cool white
      ],
    },
  },

  unknown: {
    label: 'Unknown',
    colorTemp: 0.5,
    saturation: 0.5,
    movementSpeed: 0.3,
    effectSize: 0.3,
    strobeEnabled: false,
    strobeIntensity: 0,
    phasers: { ptSlow: true, colorChase: false, dimPulse: false },
    bpmTracking: false,
    transitionTime: 2.0,
    colorPalette: {
      colors: [
        { h: 200, s: 30, l: 60 },
      ],
    },
  },
}

export function getProfile(genreId) {
  return GENRE_PROFILES[genreId] || GENRE_PROFILES.unknown
}

export const ALL_GENRES = Object.keys(GENRE_PROFILES).filter(g => g !== 'unknown')

export const TONIGHT_CONTEXTS = [
  { id: 'edm',       label: 'EDM / Electronic' },
  { id: 'techno',    label: 'Techno' },
  { id: 'hiphop',    label: 'Hip-Hop / R&B' },
  { id: 'pop',       label: 'Pop / Dance' },
  { id: 'eighties',  label: '80s / New Wave' },
  { id: 'latin',     label: 'Latin / Afrobeats' },
  { id: 'rock',      label: 'Rock' },
  { id: 'corporate', label: 'Corporate / Ambient' },
]

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Does

GMA3 Disco Pilot is an **Electron + Vite/React** desktop app (macOS) that listens to live venue audio, detects BPM and music genre locally using Essentia + Discogs-MAEST, and sends OSC messages to a GrandMA3 lighting console to drive automated looks.

---

## Commands

```bash
npm run dev          # Start Vite dev server + Electron (hot-reload)
npm run build        # vite build + electron-builder → dist/*.dmg

npm run test:bpm     # Node.js offline BPM algorithm test (synthesized audio, no Electron)
npm run test:drop    # Node.js offline drop-detection test

npm run setup:models   # Copy Essentia WASM runtime into public/models/ + download MAEST metadata
npm run check:models   # Verify all required model assets are present
npm run setup:python-ml  # Create .venv-maest with TF/tensorflowjs for model conversion
npm run convert:maest -- <model.pb> <model.json>  # Convert frozen MAEST graph to TF.js format
```

`npm run dev` launches Vite on port 5173, then waits for it and starts Electron pointing at `http://localhost:5173`. In production, Electron loads `dist/index.html`.

There is **no test runner framework** (no Jest/Vitest). `test:bpm` and `test:drop` are standalone Node.js scripts in `scripts/` that synthesize audio and run the detection algorithms directly.

---

## Architecture

### Process Model

The app has two processes communicating via Electron IPC:

- **Main process** (`electron/main.js`): Owns the `node-osc` UDP socket, HTTP server (iPad remote), WebSocket bridge (iPad control), file I/O, and macOS microphone permission. All network and disk operations the renderer needs go through `ipcMain.handle` → `ipcRenderer.invoke`.
- **Renderer process** (`src/`): React UI, Web Audio API, TensorFlow.js inference. Accesses main-process APIs only through the `contextBridge` object exposed in `electron/preload.js` as `window.electronAPI`.

The preload bridge exposes: `oscConnect/Send/Disconnect/StartReceive`, `httpStart`, `wsStart/Stop/Broadcast`, `fileSave`, `profileSave/Load/List`, `netFetchJson` (CORS-safe fetch via main), and permission event listeners.

### State Management

A single **Zustand** store at `src/store/appState.js` holds all app state. Key slices:

| Slice | Purpose |
|---|---|
| `screen` | Navigation: `'home'` → `'wizard'` → `'dashboard'` |
| `session` | Wizard outputs: fixture groups, color prefs, tonight's genre context, executor config, address map |
| `osc` | Connection status and last error |
| `live` | Real-time audio values: BPM, energy, genre, confidence |
| `overrides` | Operator controls: locked genre, manual BPM, blackout, kill-strobe, hold-freeze |

### Audio Pipeline

All audio runs in the renderer via Web Audio API. The pipeline per-detector:

1. **`src/audio/capture.js`** — opens `getUserMedia`, creates `AudioContext`, wraps the mic stream in an input gain node (default 1.6×). Returns `{ audioContext, sourceNode }`.
2. **`src/audio/bpmDetector.js`** — registers an `AudioWorkletNode` (`public/worklets/bpm-buffer-processor.js`) to collect 4096-sample frames. Uses **Meyda** to extract spectral features, applies adaptive spectral-flux onset detection + multi-band energy analysis, then blends two tempo estimators (onset-interval clustering and autocorrelation envelope). Outputs BPM every frame (~93 ms at 44.1 kHz).
3. **`src/audio/dropDetector.js`** — stateful detector (factory: `createDropDetector()`). Tracks a rolling energy baseline, arms on a pre-drop energy dip (3+ frames below 74% baseline), then triggers on a post-dip energy surge. Has three detection paths: primary (strong beat-lock), bridge (moderate lock), fallback (confirmed frames). Has a cooldown of 16 beats after each trigger.
4. **`src/audio/genreDetector.js`** — registers a second worklet (`public/worklets/genre-buffer-processor.js`) and maintains a 30-second ring buffer. Every 5 seconds it resamples to 16 kHz, extracts MAEST-compatible mel-spectrogram patches with **Essentia WASM**, and runs the TF.js `discogs-maest-30s-pw-519l` graph. Raw 519-label logits are mapped to 8 app genres via `src/audio/genreTaxonomy.js`, then smoothed and hysteresis-gated.

### Genre System

Eight app-level genres: `techno`, `edm`, `hiphop`, `pop`, `eighties`, `latin`, `rock`, `corporate`.

- **`src/audio/genreTaxonomy.js`** — maps Discogs 519-label taxonomy to the 8 genres via keyword lists. Labels use `Parent---Style` format (e.g. `Electronic---House`).
- **`src/profiles/genreProfiles.js`** — defines normalized lighting parameters (0–1) per genre: `colorTemp`, `saturation`, `movementSpeed`, `effectSize`, phaser selection, BPM-tracking flag, color palette.
- **`src/profiles/profileMapper.js`** — translates normalized profile params into OSC fader values within the operator's calibrated boundaries.

### OSC Layer

- **`src/osc/client.js`** — thin wrapper over `window.electronAPI`; enforces a 50 ms per-address rate limit. Key functions: `connect`, `send`, `sendCmd` (GMA3 text commands), `setFader`, `pressKey`.
- **`src/osc/addressMap.js`** — dynamic registry of `{ page, exec }` pairs for each function (color looks sequence, phasers, BPM/effect masters). Built after the wizard runs via `buildAddressMapFromWizard()`. Address format: `/gma3/page{N}/exec{N}/fader` or `/key`.

### Setup Wizard

`src/wizard/SetupWizard.jsx` drives a 7-step linear flow:

1. **FixtureGroupGrid** — define fixture groups and attribute capabilities (PT, RGB, color wheel, strobe, dimmer, zoom)
2. **ColorPreferences** — pick colors to avoid/emphasize per genre
3. **GenreContext** — select tonight's expected genres (boosts their weight in detection)
4. **ExecutorMap** — assign which GMA3 page/executor numbers the plugin will use
5. **PluginGenerator** — generates and downloads a `.lua` + `.xml` plugin for GMA3 import
6. **PhaserGenerator** — generates the phaser plugin
7. **OSCConnect** — establish UDP OSC connection to the console

### LUA Code Generation

`src/luagen/generatePlugin.js` emits a GMA3 v2.x LUA script that creates 8 color-look cues (one per genre), phaser sequences, and master executors. `src/luagen/generatePluginXml.js` wraps it in the MA3 XML plugin container. The generated code uses `Cmd("BlindEdit On")` to avoid disturbing live playback during setup.

### ML Model Assets

Required files in `public/models/` (not committed to git — must be set up locally):
- `essentia-wasm.es.js`, `essentia-wasm.module.wasm`, `essentia.js-core.es.js` — Essentia WASM runtime
- `discogs_519labels.txt` — 519 Discogs style labels (one per line)
- `maest-30s-pw/metadata.json` — MAEST model metadata
- `maest-30s-pw/model.json` + `group*.bin` shards — TF.js graph model

The Essentia WASM files are loaded at runtime via dynamic `import()` with `/* @vite-ignore */` to prevent Vite from trying to bundle them. The MAEST graph is loaded with `tf.loadGraphModel()`.

---

## Key Conventions

- **No linter or formatter config is present** — the codebase uses consistent 2-space indentation and single quotes throughout.
- All renderer↔main communication goes through the `window.electronAPI` bridge — never use `require('electron')` or `ipcRenderer` directly in renderer code.
- OSC addresses always follow `/gma3/page{N}/exec{N}/{fader|key}`. The `addressMap` module is the single source of truth for page/exec assignments.
- The drop detector is a pure factory function (no global state) — always call `createDropDetector()` once and feed `update()` each BPM frame.
- Genre scores are always normalized (sum to 1.0) before comparison. `normalizeScoreMap()` in `genreDetector.js` enforces this.
- `src/utils/appAssetUrl.js` provides `getAppAssetUrl(path)` which resolves correctly in both dev (`http://localhost:5173/...`) and production (`file://...`) contexts. Always use this for referencing files in `public/`.
- Root-level files (`Dashboard.jsx`, `bpmDetector.js`, `genreDetector.js`, `appState.js`, `tempoAnalysis.js`) are **legacy/draft copies** — the canonical source is under `src/`.

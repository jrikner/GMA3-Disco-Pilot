# GMA3 Disco Pilot

An AI-driven music genre detection system that automatically controls GrandMA3 lighting in real time. It listens to the music playing in the room, identifies the genre every 5 seconds, and fires the right lighting look — color temperature, phaser effects, strobe, movement speed — all mapped to genre profiles you configure once and never think about again.

Built as a macOS Electron app with a full-screen live operator dashboard. An iPad on the same network can mirror the dashboard and send control commands via WebSocket.

---

## What it does

```
Audio in → Genre detection → OSC to GrandMA3 → Lighting out
```

Every 5 seconds the app analyses the last 15 seconds of audio using [Essentia.js](https://mtg.github.io/essentia.js/) (Discogs MAEST-30s model with 519 music-style classes). It maps those predictions to 8 genre categories, applies hysteresis so it doesn't flicker, then sends OSC fader and key messages to a set of sequences and phasers already loaded in your MA3 show.

**8 Genre profiles, pre-tuned:**

| Genre | Color | Movement | Strobe |
|---|---|---|---|
| Techno | Cold blue / cyan | P/T fast, dim pulse | Yes |
| EDM / House | Purple / cyan / yellow | P/T fast, color chase, dim pulse | Yes |
| Hip-Hop / R&B | Deep purple / gold | P/T slow only | No |
| Pop / Dance | Pink / sky blue / green | Color chase | No |
| 80s / New Wave | Magenta / cyan / gold | Color chase, dim pulse | No |
| Latin / Afrobeats | Orange / green / gold | P/T slow, color chase | No |
| Rock | Red / blue / white | P/T fast, dim pulse | Yes |
| Corporate / Ambient | Warm white | Nothing | No |

Each profile controls: color look sequence, active phasers (P/T slow, P/T fast, color chase, dimmer pulse), BPM rate master, effect size master, and strobe.

---

## Requirements

- **macOS** (Electron app; Linux/Windows possible but untested)
- **GrandMA3** v2.x (software or console) on the same network
- **OSC** enabled on MA3 (port 8000 by default)
- Audio interface or built-in mic routed from the venue PA

---

## Getting Started

### 0. Clone the repo and go to the project folder

Open Terminal, then run each command one line at a time:

```bash
cd ~/Desktop
```

```bash
git clone https://github.com/jrikner/GMA3-Disco-Pilot.git
```

```bash
cd GMA3-Disco-Pilot
```

```bash
pwd
```

You should now be inside the repo root (`.../GMA3-Disco-Pilot`). Run all `npm` commands from this folder.

### 1. Install Node.js

macOS does not come with Node.js pre-installed. The easiest way is [Homebrew](https://brew.sh):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

```bash
brew install node
```

Or download the macOS installer directly from [nodejs.org](https://nodejs.org) (LTS version).

### 2. Install dependencies

```bash
npm install
```

### 3. Add Essentia model files (recommended)

Without these the app uses a spectral heuristic fallback — still works, but genre accuracy is much lower. The Home screen shows an amber notice if the files are absent.

```bash
npm install essentia.js
```

```bash
cp node_modules/essentia.js/dist/essentia-wasm.es.js public/models/
```

```bash
WASM_SRC=$(find node_modules/essentia.js/dist -maxdepth 1 -type f -name 'essentia-wasm*.wasm' | head -n 1)
```

```bash
cp "$WASM_SRC" public/models/essentia-wasm.module.wasm
```

**Optional: MAEST model for highest accuracy (~200 MB + shards)**

This model gives the app full 519-class music style classification instead of the basic heuristic, but the current browser pipeline expects a **TensorFlow.js graph model export** rather than the standalone `.onnx` file.

```bash
mkdir -p public/models public/models/maest-30s-pw
curl -L "https://huggingface.co/mtg-upf/discogs-maest-30s-pw-129e-519l/resolve/main/discogs_519labels.txt" -o public/models/discogs_519labels.txt
```

Then copy `model.json` plus every `group*.bin` file referenced inside it into `public/models/maest-30s-pw/` so this path exists:

```text
public/models/maest-30s-pw/model.json
```

If you only have `maest-30s-pw.onnx`, the app will now log a warning and stay on the spectral fallback detector instead of repeatedly throwing Essentia inference errors. The loader also verifies that `model.json` is a real TensorFlow.js graph manifest and that every referenced `group*.bin` shard is reachable before enabling Essentia inference.

See [`public/models/README.md`](public/models/README.md) for more details.

If `WASM_SRC` is empty, run `ls node_modules/essentia.js/dist` and copy the `.wasm` file you see there to `public/models/essentia-wasm.module.wasm`.

### 4. Enable OSC in GrandMA3

`Menu → System → Network Protocols → OSC`
- Enable **OSC Input** (so MA3 receives fader/key messages from the app)
- Enable **OSC Output** on port `8001` (so the app can receive feedback)
- Confirm your MA3 machine's IP address

### 5. Run the app

```bash
npm run dev
```

If you see `npm error Missing script: "dev"`, you're usually in the wrong directory. Run `pwd` and make sure you are inside this repo folder, then run `npm run dev` again.

The Electron window opens. Click **New Session** and work through the 8-step wizard.

### 6. Run the wizard

| Step | What to do |
|------|-----------|
| 1 — Fixture Groups | Name your fixture groups exactly as they appear in MA3. Tick which attributes each group has (P/T, RGB, strobe, etc.). Give the session a name here. |
| 2 — Color Preferences | Choose colors to avoid or emphasise across all genre looks. |
| 3 — Tonight's Context | Tick which genres you expect tonight. These get a 2× confidence boost in detection. |
| 4 — Free Executor Spaces | Tell the app which page and starting executor number it can use. It needs 14 consecutive free executors. |
| 5 — Generate MA3 Plugin | Download `GMA3_Disco_Pilot_Plugin.lua`. Import it into MA3 as a Plugin and run it once. It creates 8 color look sequences + 2 master executors. |
| 6 — Phaser Plugin | Download `GMA3_Disco_Pilot_Phasers.lua`. Run it separately after the main plugin. Creates P/T and effect phasers. Verify in MA3's Effect Engine afterward. |
| 7 — OSC Connection | Enter your MA3 machine's IP and port. Click Connect. |
| 8 — Fader Calibration | For each executor the app sweeps the fader while you mark the safe max and min. Saves your profile at the end. |

After calibration you land on the live dashboard. Click **Save Profile** on the calibration complete screen to save — next time load the profile from the Home screen and skip the wizard entirely.

---

## The Live Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│ GMA3 DISCO PILOT            OSC 192.168.1.10:8000  BLACKOUT │
├─────────────────┬─────────────────┬─────────────────────────┤
│  GENRE          │  AUDIO          │  ACTIVE PROFILE         │
│                 │                 │                         │
│  EDM / House    │  128 BPM        │  Color temp ████░ 20    │
│  92% confidence │  Energy ██████  │  Saturation █████████   │
│  ── top 3 ────  │  Spectral ████  │  Movement ████████ 75   │
│  EDM       92%  │                 │  Effect   ████████ 75   │
│  Techno    06%  │  [Input: USB]   │  Strobe   ███ 50        │
│  Pop       02%  │                 │                         │
├─────────────────┼─────────────────┼─────────────────────────┤
│  CONTROLS       │  FORCE GENRE    │  PHASERS                │
│                 │                 │                         │
│  [Tap BPM]      │  [EDM]  [Techno]│  P/T Slow    ● active ○ │
│  [Auto BPM ✓]   │  [Hip-Hop][Pop] │  P/T Fast    ● active ● │
│  [Genre Auto]   │  [80s] [Latin]  │  Color Chase ● active ● │
│  [● Live]       │  [Rock][Corp]   │  Dim Pulse   ● active ● │
│                 │                 │  Strobe Kill          ○ │
│  ▸ Context      │  PANIC PRESETS  │                         │
│  ▸ History (12) │  [ALL WHITE]    │                         │
│                 │  [FULL BLACKOUT]│                         │
│                 │  [HOLD+FREEZE]  │                         │
│                 │  [HOUSE DEFAULT]│                         │
└─────────────────┴─────────────────┴─────────────────────────┘
```

### Key controls

| Control | What it does |
|---------|-------------|
| **BLACKOUT** (top right) | Immediately zeroes all app-controlled faders and releases all executors in MA3. Press again to restore. |
| **Kill Strobe** (top right) | Cuts strobe independently without affecting the rest of the look. Toggle back to restore. |
| **Force Genre chips** | Tap a genre to lock it. The app stops detecting and holds that look. Tap again to unlock. |
| **Tap BPM** | Tap in time to override the detected BPM. Clears automatically after 4 seconds without taps. |
| **HOLD + FREEZE** | Stops all automation — BPM tracking, genre detection, energy response. Everything holds at the current state. |
| **Tonight's Context** | Open ▸ and toggle genres on/off to boost detection weight during the show. Useful when the set list changes. |
| **History** | Shows a timestamped list of genre changes with BPM and confidence. Export as CSV for post-event review. |

### Panic presets

These fire instantly without rate limiting.

| Button | What it sends |
|--------|---------------|
| **All White** | `ClearAll` → selects all fixture groups → Dimmer 100 + Saturation 0 |
| **Full Blackout** | Same as the BLACKOUT toggle |
| **Hold + Freeze** | Locks the current look and stops all automation |
| **House Default** | Fires a specific executor you designate in session settings (configure `panicConfig.houseDefaultExec`) |

---

## iPad Companion

The iPad can mirror the full dashboard and send control commands over WebSocket.

1. Start the HTTP server from the dashboard (or add a `wsStart` call at startup — see `Dashboard.jsx`)
2. Find your Mac's local IP: `System Preferences → Network`
3. On iPad Safari: open `http://[mac-ip]:3030`
4. The React UI loads in browser mode; buttons relay commands via WebSocket back to the Mac, which translates them to OSC

The WebSocket server runs on the HTTP port + 1.

---

## MA3 Plugin Notes

### Main plugin (`GMA3_Disco_Pilot_Plugin.lua`)

Creates 14 executors on the page and start executor you configure:

```
Exec +0  to +7   →  Color look sequences (one per genre)
Exec +8  onward   →  Phaser sequences (P/T slow + optional P/T fast, pan-only, tilt-only + color + dim)
Exec +?          →  BPM Rate Master (immediately after the last phaser)
Exec +?          →  Effect Size Master (immediately after BPM master)
```

After running: right-click the Rate Master executor → set type to **SpeedMaster**. Right-click the Effect Size executor → set type to **SizeMaster**. The app controls these via fader level, not direct speed assignment.

### Phaser plugin (`GMA3_Disco_Pilot_Phasers.lua`)

Creates a deterministic, contiguous phaser block starting from `Exec +8`, using MA3's Effect Engine. The set is:

- Always included (when mover groups exist): `DP_PHASER_PT_SLOW`
- Optional toggles: `DP_PHASER_PT_FAST`, `DP_PHASER_PAN_ONLY`, `DP_PHASER_TILT_ONLY`
- Optional movement presets: per-sequence P/T, Pan-only, Tilt-only preset references (entered in wizard)
- Included when RGB groups exist: `DP_PHASER_COLOR`
- Always included: `DP_PHASER_DIM`

Because phaser creation via `gma.cmd()` is not fully documented in MA3 v2.x:

1. After running, open each generated `DP_PHASER_*` sequence in MA3
2. Verify Cue 1 has an effect in the programmer
3. If not: use the Effect Engine panel to add/adjust the phaser manually (for example Pan/Tilt Sinus Width 30 Rate 0.3 for slow; Width 45 Rate 1.2 for fast)
4. Store back to the sequence cue

The generated script includes a step-chase alternative in comments for `DP_PHASER_PT_SLOW` — uncomment it if the Effect Engine approach doesn't work for your fixture types.

Movement phasers are assigned as **Temp faders** so the app can randomize movement emphasis (P/T combined vs Pan-only vs Tilt-only, including weighted mixes) every 3 minutes, on genre changes, and on detected drops.

---

## Tips & Tricks

**Start with context.** At the beginning of the night, open the "Tonight's Context" panel and check which genres the DJ is playing. Even one or two correct hints doubles detection accuracy.

**Pre-warm for 5 seconds.** The genre detector needs at least 5 seconds of audio before it makes its first analysis. At the very start of a set it'll show "Analyzing…" — this is normal.

**Use Hold+Freeze during speech.** When the DJ talks on the mic or someone gives a speech, hit Hold+Freeze so the lighting doesn't react to spoken word frequencies. Unfreeze when music starts again.

**Tap BPM for difficult tracks.** Meyda's BPM detection is reliable for 4/4 music but can wander on half-time feels or complex polyrhythms. If you see the rate master flickering, tap in the BPM manually and it stays locked until you reset.

**Calibrate conservatively.** When marking fader boundaries during calibration, set the MAX a little below what you think is possible. Leaving headroom prevents the app from accidentally pushing a dimmer or strobe to a level that could cause issues during a show.

**Profile per venue.** After calibrating for a venue, save the profile with a descriptive name (`Friday-ClubX`, `Corporates-2026`). Next time you're there, load it from the Home screen — OSC settings, executor mapping, and fader boundaries are all restored.

**Silence detection is automatic.** If the music stops, the app detects silence and holds the current look rather than switching to "Corporate/Ambient" which would look strange. It resumes detecting as soon as the music comes back.

---

## Troubleshooting

### OSC not reaching MA3

- Confirm MA3 has OSC Input enabled under `Menu → System → Network Protocols → OSC`
- Confirm the IP and port in the wizard match. Default MA3 port is **8000**
- Check that both machines are on the same subnet (e.g. both on 192.168.1.x)
- Disable the Mac firewall temporarily to rule it out: `System Preferences → Security & Privacy → Firewall`
- Try pinging the MA3 machine from Terminal to confirm basic connectivity

### Genre detection is wrong or stuck

- Open the Audio panel on the dashboard and confirm the BPM and Energy meters are moving — if they're flat, the mic/audio input isn't reaching the app
- Switch input device using the dropdown at the bottom of the Audio panel
- Check the browser console (`Cmd+Option+I` in dev mode) for `[GenreDetector]` log messages
- Add the Essentia TensorFlow.js graph-model files (`public/models/maest-30s-pw/model.json` + shards) for significantly better accuracy
- Use "Tonight's Context" to hint which genres are actually playing

### Phasers not moving after running the plugin

- Check that the phaser sequences were created: open the Sequence view in MA3 and look for `DP_PHASER_PT_SLOW`, etc.
- If cues exist but no effect is visible: open the sequence → Cue 1 → Effect Engine panel → manually add a Sinus effect to Pan/Tilt → store back
- Alternatively uncomment the step-chase fallback in `GMA3_Disco_Pilot_Phasers.lua` and re-run

### Rate/Size Masters not responding

- After running the main plugin, right-click the `DP_RATE_MASTER` executor and set its type to **SpeedMaster**
- Do the same for `DP_FX_MASTER` → **SizeMaster**
- Then assign your phaser sequences to use that SpeedMaster in their sequence properties

### Blackout button pressed but lights still on

- The blackout sends OSC to zero the executors the app manages. It does not affect any other executors or groups in your show
- If MA3's Grand Master or another sequence is running at full that overrides the app's output, blackout won't help — you need to use MA3's own blackout for that

### iPad shows dashboard but buttons do nothing

- Check the Electron terminal for `[WS] iPad connected from ...` — if it's not there the WebSocket connection failed
- Make sure the iPad is on the same Wi-Fi network as the Mac
- The HTTP and WebSocket servers start automatically when the dashboard loads. If they didn't start, check the Electron console for errors.

### App launches but the Electron window is black

If Terminal shows `EACCES: permission denied, mkdir ... node_modules/.vite/...`, your `node_modules` files are owned by another user (often from running `sudo npm install` once).

Fix ownership from the project root:

```bash
sudo chown -R $(whoami) node_modules
rm -rf node_modules/.vite
npm install
npm run dev
```

If you also see `Failed to resolve import "/models/essentia-wasm.es.js"`, install/copy the optional Essentia model files:

```bash
mkdir -p public/models
npm install essentia.js
cp node_modules/essentia.js/dist/essentia-wasm.es.js public/models/
# Some essentia.js versions publish a different WASM filename in dist/
WASM_SRC=$(find node_modules/essentia.js/dist -maxdepth 1 -type f -name 'essentia-wasm*.wasm' | head -n 1)
cp "$WASM_SRC" public/models/essentia-wasm.module.wasm
```

Without Essentia files, the app will still run with the spectral fallback detector, but accuracy is lower.

### App crashes or freezes on startup (macOS)

- Run `npm run dev` from Terminal and watch the output — the Electron log will show the error
- If it's a permissions error on the microphone: `System Preferences → Security & Privacy → Privacy → Microphone` → enable Terminal or Electron
- Packaged macOS builds now treat app-owned `file://` microphone requests as trusted too, so if Sound In still shows `permission denied`, fully quit and relaunch the app once after updating so macOS and Electron re-check the permission state

---

## Project Structure

```
├── electron/
│   ├── main.js          ← Electron main: OSC client/server, HTTP, WebSocket, file I/O
│   └── preload.js       ← IPC bridge exposed to renderer (contextBridge)
│
├── src/
│   ├── audio/
│   │   ├── capture.js       ← getUserMedia, audio device enumeration
│   │   ├── bpmDetector.js   ← Meyda BPM + energy + spectral features
│   │   └── genreDetector.js ← Essentia.js MAEST model + spectral heuristic fallback
│   │
│   ├── profiles/
│   │   ├── genreProfiles.js  ← 8 genre parameter definitions
│   │   └── profileMapper.js  ← Translates genre + audio frame → OSC messages
│   │
│   ├── osc/
│   │   ├── client.js         ← OSC send/receive wrappers (via Electron IPC)
│   │   └── addressMap.js     ← Dynamic executor address registry
│   │
│   ├── luagen/
│   │   ├── generatePlugin.js       ← Main LUA plugin generator
│   │   └── generatePhaserPlugin.js ← Separate phaser LUA generator
│   │
│   ├── wizard/
│   │   ├── SetupWizard.jsx       ← 8-step wizard shell
│   │   ├── FixtureGroupGrid.jsx  ← Step 1: fixture groups + session name
│   │   ├── ColorPreferences.jsx  ← Step 2
│   │   ├── GenreContext.jsx      ← Step 3
│   │   ├── ExecutorMap.jsx       ← Step 4: free executor allocation
│   │   ├── PluginGenerator.jsx   ← Step 5: main LUA download
│   │   ├── PhaserGenerator.jsx   ← Step 6: phaser LUA download
│   │   ├── OSCConnect.jsx        ← Step 7
│   │   └── Calibration.jsx       ← Step 8: fader boundary sweep
│   │
│   ├── dashboard/
│   │   ├── Dashboard.jsx         ← Live operator dashboard
│   │   └── Dashboard.module.css
│   │
│   ├── store/
│   │   └── appState.js    ← Zustand store (session, live state, overrides, history)
│   │
│   ├── Home.jsx
│   └── App.jsx
│
└── public/
    └── models/
        └── README.md      ← Instructions for Essentia model files
```

---

## Building for Distribution

```bash
npm run build
```

Produces a `.dmg` in `dist/`. The `public/models/` directory is included in the bundle, but model files are not — users must add them separately (they are too large to ship in the repo).

---

## License

MIT

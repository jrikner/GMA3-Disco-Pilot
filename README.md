# GMA3 Disco Pilot

GMA3 Disco Pilot is an Electron app that listens to venue audio, detects BPM + genre locally, and drives GrandMA3 looks over OSC.

This branch uses a rebuilt **Essentia + Discogs-MAEST** genre pipeline:

- **Essentia** for audio preprocessing.
- **Discogs-MAEST 30s PW 519-label** as the source genre taxonomy.
- **TensorFlow.js** for browser/Electron inference.
- A local mapping layer that collapses the 519 Discogs styles into the app's lighting genres.

---

## 1. What you need

### Always required

- **macOS** with microphone access
- **Node.js 20+**
- **npm** (included with Node)
- A working **GrandMA3 OSC setup** if you want to control a console live

### Required only for full genre detection

The repository does **not** commit the full MAEST runtime to Git. For live genre detection you must provide:

- Essentia browser runtime files
- MAEST metadata + labels
- A **TensorFlow.js** export of the official `discogs-maest-30s-pw-519l` frozen graph

If these files are missing, the app still opens and BPM works, but **genre detection stays unavailable**.

---

## 2. Fast install

From the repo root:

```bash
npm install
npm run setup:models
npm run check:models
```

What this does:

- Installs Node dependencies.
- Copies Essentia browser runtime files into `public/models/`.
- Downloads MAEST metadata (and labels when available), then validates model asset status.

At this stage, `check:models` may still report the TF.js graph as missing. That is expected until Section 6 is complete.

---

## 3. macOS setup

If you are on macOS and want the full MAEST conversion pipeline, do this once.

### Install Node

Using Homebrew:

```bash
brew install node
```

### Install a compatible Python

The conversion stack in this repo supports Python **3.9-3.12**.

```bash
brew install python@3.12
```

If `python3.12` is not found in your shell afterwards, add it to PATH:

```bash
echo 'export PATH="$(brew --prefix python@3.12)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Create the converter virtual environment

```bash
npm run setup:python-ml
```

This creates `.venv-maest` and installs pinned dependencies used by this repo:

- `tensorflow==2.19.0`
- `tf-keras==2.19.0`
- `tensorflowjs==4.22.0`
- `tensorflow-decision-forests==1.12.0`

Notes:

- The script prefers `python3.12`, `python3.11`, `python3.10`, then `python3.9`.
- If `.venv-maest` already exists with the wrong Python release, it is recreated automatically.
- You do not need to manually activate `.venv-maest` before running `npm run convert:maest`.

---

## 4. Get the Essentia browser runtime ready

Run:

```bash
npm run setup:models
```

After this, you should have:

```text
public/models/essentia-wasm.es.js
public/models/essentia-wasm.module.wasm
public/models/essentia.js-core.es.js
public/models/discogs_519labels.txt
public/models/maest-30s-pw/metadata.json
```

If direct label download fails, the setup script automatically derives `discogs_519labels.txt` from `metadata.json` when possible.

---

## 5. Get the MAEST model

This project is built around:

- **Model:** `discogs-maest-30s-pw-519l`
- **Input:** mono audio at **16 kHz**
- **Taxonomy:** **519 Discogs styles**

Download the official frozen graph (`.pb`) and metadata (`.json`) from Essentia:

- Model index: [https://essentia.upf.edu/models/feature-extractors/maest/](https://essentia.upf.edu/models/feature-extractors/maest/)
- `.pb`: [https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.pb](https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.pb)
- `.json`: [https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.json](https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.json)

Example download commands:

```bash
curl -L -o ~/Downloads/discogs-maest-30s-pw-519l-2.pb \
  https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.pb
curl -L -o ~/Downloads/discogs-maest-30s-pw-519l-2.json \
  https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.json
```

---

## 6. Convert the MAEST graph to TensorFlow.js format

From the repo root:

```bash
npm run convert:maest -- \
  ~/Downloads/discogs-maest-30s-pw-519l-2.pb \
  ~/Downloads/discogs-maest-30s-pw-519l-2.json
```

This writes:

```text
public/models/discogs_519labels.txt
public/models/maest-30s-pw/metadata.json
public/models/maest-30s-pw/model.json
public/models/maest-30s-pw/group*.bin
```

Verify again:

```bash
npm run check:models
```

Expected status:

- Essentia runtime: ready
- Discogs labels: ready
- MAEST metadata: ready
- MAEST TF.js graph: ready

---

## 7. Run the app

Development mode:

```bash
npm run dev
```

On first launch:

- Grant macOS microphone permission when prompted.
- Start with **New Session** to run the wizard.

If you only want to test UI/wizard first, you can run before MAEST conversion is done. The app opens, but genre detection stays unavailable until Section 6 is complete.

Create a macOS app build (DMG):

```bash
npm run build
```

Output is written in `dist/` (for example `dist/GMA3 Disco Pilot-0.1.0-arm64.dmg`).

---

## 8. Configure GrandMA3

On GrandMA3:

1. Go to **Menu -> Setup -> Network -> OSC**.
2. Enable OSC.
3. Set OSC Input Port (default: `8000`).
4. Set OSC Output Port to a different port (usually `8001`) for dashboard feedback.
5. Note the MA3 IP address.

In the app:

1. Click **New Session**.
2. Complete all wizard sections: `Fixture Groups`, `Color Preferences`, `Tonight's Context`, `Free Executor Spaces`, `Generate MA3 Plugin`, `Phaser Plugin`, `OSC Connection`.

Plugin import on MA3:

1. Copy generated plugin files to MA3 plugin storage or USB.
2. In MA3 go to **Menu -> Plugins -> Import Plugin**.
3. Import the `.xml` wrapper.
4. Run the plugin in the Plugins view.

---

## 9. What the remodeled detector does

Live detection and control flow:

1. Captures live audio from selected input device.
2. Runs BPM estimation with stabilization and manual override support.
3. Runs drop detection with calibration/best-effort fallback.
4. Maintains a rolling **30-second** genre analysis window.
5. Resamples to **16 kHz** and extracts MAEST-compatible mel features with Essentia.
6. Runs the converted TensorFlow.js MAEST graph (`model.json` + shards).
7. Maps 519 Discogs styles into app-level lighting genres.
8. Applies smoothing/hysteresis and optional tonight-context weighting.
9. Sends OSC look/phaser/master updates to GrandMA3.

---

## 10. Troubleshooting

### `npm run check:models` says TF.js graph is missing

Run conversion first:

```bash
npm run convert:maest -- /path/to/model.pb /path/to/model.json
```

### `npm run convert:maest` fails with `python: command not found` on macOS

Install compatible Python and set up repo venv:

```bash
brew install python@3.12
npm run setup:python-ml
```

### `npm run convert:maest` says `tensorflowjs` converter is missing

Run:

```bash
npm run setup:python-ml
```

or install the same packages into your own interpreter:

```bash
python3 -m pip install tensorflow==2.19.0 tf-keras==2.19.0 tensorflowjs==4.22.0 tensorflow-decision-forests==1.12.0
```

### `npm run setup:python-ml` fails with `No matching distribution found for tensorflow`

You are likely using an unsupported Python version (common case: Python `3.14`). Use Python `3.9-3.12`.

### `npm run setup:python-ml` fails with `ResolutionImpossible`

Rerun `npm run setup:python-ml`. The script pins a known-good dependency set and repairs old `.venv-maest` environments.

### `npm run convert:maest` fails with protobuf errors from `tensorflow_decision_forests` or `ydf`

Pull latest repo changes and rerun conversion. The repo uses a dedicated frozen-graph helper to avoid the problematic converter import path.

### I only have an `.onnx` file

That is not enough for this app. You need a TensorFlow.js graph export:

- `model.json`
- all referenced `group*.bin` shards

### The app opens but genre detection is unavailable

One or more of these files is still missing:

- `public/models/essentia-wasm.es.js`
- `public/models/essentia-wasm.module.wasm`
- `public/models/essentia.js-core.es.js`
- `public/models/discogs_519labels.txt`
- `public/models/maest-30s-pw/metadata.json`
- `public/models/maest-30s-pw/model.json`
- required `group*.bin` shards

Run:

```bash
npm run setup:models
npm run check:models
```

### No audio input or microphone error in app

- Check macOS permission: **System Settings -> Privacy & Security -> Microphone**.
- Make sure the correct input device is selected in the dashboard.
- Restart the app after granting permission.

---

## 11. Useful commands

```bash
npm install
npm run setup:models
npm run check:models
npm run setup:python-ml
npm run convert:maest -- /path/to/model.pb /path/to/model.json
npm run dev
npm run test:bpm
npm run test:drop
npm run build
```

---

## 12. Project structure

```text
electron/main.js
src/audio/genreDetector.js
src/audio/bpmDetector.js
src/audio/dropDetector.js
src/dashboard/Dashboard.jsx
src/wizard/SetupWizard.jsx
src/luagen/generatePlugin.js
src/luagen/generatePhaserPlugin.js
src/osc/addressMap.js
scripts/model-assets.mjs
scripts/setup-python-ml.mjs
scripts/convert-maest-frozen-model.mjs
public/models/README.md
```

---

## License

MIT

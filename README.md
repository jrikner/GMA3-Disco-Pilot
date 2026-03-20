# GMA3 Disco Pilot

An Electron control app that listens to venue audio, estimates genre/BPM/energy on-device, and drives GrandMA3 looks over OSC. The renderer can use Essentia.js + the Discogs MAEST label set for higher-accuracy music classification, but the app always has a built-in heuristic fallback so you can still launch and program without the full model bundle.

---

## What this repo includes

The repo already contains the application source, Electron shell, OSC bridge, MA3 plugin generators, and UI. After `npm install`, you have everything needed to **run the app itself**.

What is **not** committed to Git is the optional model payload that lives under `public/models/` at runtime:

- `essentia-wasm.es.js`
- `essentia-wasm.module.wasm`
- `discogs_519labels.txt`
- `maest-30s-pw/model.json` plus every `group*.bin` shard it references

Those files are omitted because they are generated/distributed outside this repo, and the MAEST TensorFlow.js export is large.

### Why you do not see `.json` files in the repo

You are not missing a hidden folder: this repository does **not** ship `public/models/maest-30s-pw/model.json`. The current app only uses that file if **you** add an external **TensorFlow.js graph model export**. A standalone `maest-30s-pw.onnx` file is **not** enough for the browser pipeline in `src/audio/genreDetector.js`. The app will fall back to the spectral detector instead.

---

## Quick start

### 1. Install Node.js

Use the current Node.js LTS release. On macOS, Homebrew is the easiest route:

```bash
brew install node
```

### 2. Install app dependencies

From the repo root:

```bash
npm install
```

### 3. Copy/download the optional model runtime files

Run the helper script from the repo root:

```bash
npm run setup:models
```

That command does three things:

1. installs `essentia.js` locally without adding it to `package.json`
2. copies the Essentia runtime files into `public/models/`
3. tries to download `discogs_519labels.txt` into `public/models/`

Then verify what is present:

```bash
npm run check:models
```

### 4. Understand what `setup:models` can and cannot fetch

After `npm run setup:models`, you should normally have:

```text
public/models/essentia-wasm.es.js
public/models/essentia-wasm.module.wasm
public/models/discogs_519labels.txt
```

You will **not** automatically get this file from the repo:

```text
public/models/maest-30s-pw/model.json
```

That is expected. The repository does not contain the MAEST TensorFlow.js graph export, and the helper script cannot invent it. If `npm run check:models` says the MAEST graph is missing, the app will still launch and work in heuristic mode.

### 5. Run the app

```bash
npm run dev
```

The home screen warns you if Essentia runtime files are missing. If the optional MAEST graph is missing, the app still starts and the detector stays on the fallback path.

---

## Model asset details

### Minimum optional assets for better runtime support

These files let the app load the Essentia runtime:

| File | Required for | How to get it |
|---|---|---|
| `public/models/essentia-wasm.es.js` | loading Essentia.js in the browser | copied by `npm run setup:models` |
| `public/models/essentia-wasm.module.wasm` | actual WASM runtime | copied by `npm run setup:models` |
| `public/models/discogs_519labels.txt` | mapping MAEST outputs to labels | downloaded by `npm run setup:models` when network access to Hugging Face works |

### Full high-accuracy MAEST setup

For the full 519-label graph-model path, the renderer expects a **TensorFlow.js graph model export** here:

```text
public/models/maest-30s-pw/model.json
public/models/maest-30s-pw/group*.bin
```

Important notes:

- A plain `.onnx` file does not satisfy the current browser loader.
- `src/audio/genreDetector.js` probes for `/models/maest-30s-pw/model.json` at runtime before enabling graph inference.
- If the graph or labels are missing, the app logs a warning and stays on the spectral heuristic fallback.

If you already have a TensorFlow.js export from another workflow, copy the entire folder contents into `public/models/maest-30s-pw/`, then rerun:

```bash
npm run check:models
```

For more focused instructions, see [`public/models/README.md`](public/models/README.md).

---

## GrandMA3 setup

Enable OSC in GrandMA3 under `Menu -> System -> Network Protocols -> OSC`:

- turn on **OSC Input** so MA3 accepts fader/key messages from the app
- turn on **OSC Output** on port `8001` if you want feedback back into the app
- note the MA3 machine IP address you will enter in the wizard

---

## First-run workflow inside the app

1. Click **New Session**.
2. Enter fixture groups exactly as they appear in MA3.
3. Choose color preferences and tonight's genre context.
4. Choose a free executor page/start range.
5. Download and import the generated MA3 plugin.
6. Download and run the phaser plugin.
7. Connect OSC.
8. Calibrate fader min/max values and save the profile.

The wizard generates the LUA/XML plugin files for you; those downloads are unrelated to the optional `public/models/*.json` runtime assets.

---

## Troubleshooting

### `npm run setup:models` finishes, but there is still no `model.json`

That is normal. The setup helper only installs/copies what can be sourced automatically from `essentia.js` plus the public label text file. The MAEST TensorFlow.js graph export is still a manual add-on.

### I only have `maest-30s-pw.onnx`

The app will not load it directly. Right now the renderer expects a TensorFlow.js graph model manifest and its shard files, not ONNX.

### `npm run check:models` says runtime files are missing

Make sure you ran the command from the repo root and that `npm run setup:models` completed successfully. If your machine blocks the label download, rerun the command later or place `discogs_519labels.txt` into `public/models/` manually.

### The app starts, but Home says heuristic mode

That means `public/models/essentia-wasm.es.js` was not found by the browser check. Run:

```bash
npm run setup:models
npm run check:models
```

then restart `npm run dev`.

### The app starts, Essentia loads, but genre accuracy is still low

That usually means the runtime files exist but `public/models/maest-30s-pw/model.json` and its `group*.bin` shards are still missing. In that case the app intentionally stays on the fallback detector.

---

## Project structure

```text
electron/main.js                 # Electron main process, OSC bridge, local file/profile I/O
electron/preload.js              # contextBridge API for the renderer
src/audio/genreDetector.js       # Essentia/MAEST loading + heuristic fallback logic
src/wizard/PluginGenerator.jsx   # main MA3 plugin download
src/wizard/PhaserGenerator.jsx   # phaser plugin download
public/models/README.md          # model asset instructions
scripts/model-assets.mjs         # helper for copying/checking model assets
```

---

## Build

```bash
npm run build
```

`public/models/` is included in the packaged app, but large optional model assets are still your responsibility to place there before packaging or after installation.

---

## License

MIT

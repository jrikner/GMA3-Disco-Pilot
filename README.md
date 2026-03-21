# GMA3 Disco Pilot

GMA3 Disco Pilot is an Electron app that listens to venue audio, detects BPM + genre locally, and drives GrandMA3 looks over OSC.

This branch uses a rebuilt **Essentia + Discogs-MAEST** genre pipeline:

- **Essentia** for audio preprocessing.
- **Discogs-MAEST 30s PW 519-label** as the source genre taxonomy.
- **TensorFlow.js** for the browser/Electron graph runtime.
- A local mapping layer that collapses the 519 Discogs styles into the app’s larger lighting genres.

---

## 1. What you need

### Always required

- **Node.js 20+**
- **npm**
- A working **GrandMA3** OSC setup if you want to control a console

### Required only for full genre detection

The app does **not** commit the MAEST model runtime to Git. You must provide these runtime assets yourself:

- Essentia browser runtime files
- MAEST metadata + labels
- A **TensorFlow.js** export of the official `discogs-maest-30s-pw-519l` frozen graph

If those files are missing, the app still opens, but **live genre detection will stay unavailable** until you add them.

---

## 2. Fast install

From the repo root:

```bash
npm install
```

Then copy/download the browser-side Essentia assets:

```bash
npm run setup:models
```

Check what is present:

```bash
npm run check:models
```

---

## 3. macOS setup

If you are on a Mac and want the full MAEST conversion pipeline to work cleanly, do this once:

### Install Node

Using Homebrew:

```bash
brew install node
```

### Install Python 3

The TensorFlow.js conversion stack used by this repo installs cleanly on Python **3.9-3.12**. If your default Homebrew `python3` is newer than that, install a supported version explicitly:

Using Homebrew:

```bash
brew install python@3.12
```

### Create the Python ML environment used by the converter

```bash
npm run setup:python-ml
```

That command creates `.venv-maest` and installs the conversion dependencies used by this repo:

- `tensorflow==2.19.0`
- `tf-keras==2.19.0`
- `tensorflowjs==4.22.0`
- `tensorflow-decision-forests==1.12.0`

> On macOS this is important because `python` is often missing while `python3` exists. The setup script now prefers `python3.12`, `python3.11`, `python3.10`, and `python3.9` before generic `python3`/`python`, because the TensorFlow.js conversion stack used here does not publish compatible wheels for newer Python releases such as `3.14`.
>
> If `.venv-maest` already exists but was created with an incompatible or different Python release, the setup script recreates it automatically before installing packages.
>
> It also uses the repo-local `.venv-maest/bin/python` or `.venv-maest/bin/python3` directly when that environment exists, so you do not need to manually activate it before running `npm run convert:maest`. The converter checks both the current working directory and the script's own repo path so symlinked repo locations still reuse the repo-managed virtualenv.

---

## 4. Get the Essentia browser runtime ready

Run:

```bash
npm run setup:models
```

This copies the Essentia browser runtime into `public/models/` and downloads the official MAEST metadata.

After that, you should have these files:

```text
public/models/essentia-wasm.es.js
public/models/essentia-wasm.module.wasm
public/models/essentia.js-core.es.js
public/models/discogs_519labels.txt
public/models/maest-30s-pw/metadata.json
```

If `discogs_519labels.txt` cannot be downloaded directly, the setup script derives it from the official metadata file automatically.

---

## 5. Get the MAEST model

This project is built around the official Essentia MAEST entry:

- **Model:** `discogs-maest-30s-pw-519l`
- **Input expectation:** mono audio at **16 kHz**
- **Taxonomy:** **519 Discogs music styles**

You need the official frozen graph (`.pb`) and its metadata (`.json`).

Place them anywhere on your machine, for example:

```text
~/Downloads/discogs-maest-30s-pw-519l-2.pb
~/Downloads/discogs-maest-30s-pw-519l-2.json
```

---

## 6. Convert the MAEST graph to TensorFlow.js format

From the repo root:

```bash
npm run convert:maest -- ~/Downloads/discogs-maest-30s-pw-519l-2.pb ~/Downloads/discogs-maest-30s-pw-519l-2.json
```

That writes:

```text
public/models/discogs_519labels.txt
public/models/maest-30s-pw/metadata.json
public/models/maest-30s-pw/model.json
public/models/maest-30s-pw/group*.bin
```

Run the checker again:

```bash
npm run check:models
```

You want it to report:

- Essentia runtime: ready
- Discogs labels: ready
- MAEST metadata: ready
- MAEST TF.js graph: ready

---

## 7. Run the app

```bash
npm run dev
```

If you only want to test the UI/wizard first, you can run the app before the TF.js graph exists. The app will open, but the dashboard will show that genre detection is unavailable until the MAEST graph is installed.

---

## 8. Configure GrandMA3

In GrandMA3:

1. Go to **Menu → System → Network Protocols → OSC**
2. Enable **OSC Input**
3. Enable **OSC Output** on port `8001`
4. Note the MA3 machine IP address

Then in the app:

1. Click **New Session**
2. Complete the wizard
3. Enter your MA3 host/port details
4. Generate/import the plugin files
5. Calibrate and save the profile

---

## 9. What the remodeled detector does

The new detector:

1. streams live audio from the worklet
2. keeps a rolling **30-second** analysis window
3. resamples that window to **16 kHz**
4. extracts MAEST-compatible mel features with **Essentia**
5. runs the converted **TensorFlow.js** MAEST graph
6. maps the 519 Discogs styles into the app’s broad genres
7. smooths and stabilizes the result before switching lighting profiles

---

## 10. Troubleshooting

### `npm run check:models` says the graph is missing

You have not converted or copied the TensorFlow.js export yet. Run:

```bash
npm run convert:maest -- /path/to/model.pb /path/to/model.json
```

### `npm run convert:maest` fails on macOS with `python: command not found`

Run:

```bash
npm run setup:python-ml
```

The converter now prefers `python3`, but Python 3 still needs to be installed first.

### `npm run convert:maest` says the tensorflowjs converter is missing

`brew install python` only installs the Python interpreter. It does **not** install Python packages such as `tensorflow`, `tf-keras`, or `tensorflowjs`.

On Python 3.12+, `pkg_resources` also comes from `setuptools`, so the repo setup now upgrades `setuptools` inside `.venv-maest` as part of `npm run setup:python-ml`. If you created the venv before this fix, rerun setup once to repair it.

`npm run convert:maest` now uses the repo-local virtualenv executable directly when `.venv-maest/bin/python` or `.venv-maest/bin/python3` exists, and otherwise checks several Python candidates on your `PATH` and reports which ones have the `tensorflowjs` converter installed. It also resolves the repo root from both your current directory and the converter script path. If the repo-local `.venv-maest` exists but is missing packages, rerun setup to repair it:

```bash
npm run setup:python-ml
npm run convert:maest -- /path/to/model.pb /path/to/model.json
```

If you want to use your own interpreter instead of `.venv-maest`, install the required packages with pip into that same interpreter:

```bash
python3 -m pip install tensorflow==2.19.0 tf-keras==2.19.0 tensorflowjs==4.22.0 tensorflow-decision-forests==1.12.0
```

### `npm run setup:python-ml` fails with `No matching distribution found for tensorflow`

That usually means you are using a Python version that the conversion stack in this repo does not support. A common case on macOS is Homebrew Python `3.14`.

Install a supported interpreter such as Python `3.12`, then rerun setup:

```bash
brew install python@3.12
npm run setup:python-ml
```

The setup script now prefers `python3.12`, `python3.11`, `python3.10`, and `python3.9` automatically when they are available.

If `.venv-maest` was previously created with Python `3.14`, rerunning `npm run setup:python-ml` now recreates that environment automatically.

### `npm run setup:python-ml` fails with `ResolutionImpossible`

This usually means pip selected an incompatible `tensorflow-decision-forests` release while trying to satisfy `tensorflowjs`.

The setup script now pins the compatible combination used by this repo:

- `tensorflow==2.19.0`
- `tf-keras==2.19.0`
- `tensorflowjs==4.22.0`
- `tensorflow-decision-forests==1.12.0`

If you created `.venv-maest` before this fix, rerun `npm run setup:python-ml` and the environment will be updated with the pinned dependency set.

### `npm run convert:maest` fails with a protobuf version error from `tensorflow_decision_forests` or `ydf`

If the traceback mentions a message like `gencode 6.31.1 runtime 5.29.6`, the failure is happening while the generic TensorFlow.js converter bootstraps optional SavedModel support. MAEST frozen-graph conversion does not need that code path.

This repo now uses a dedicated frozen-graph conversion helper that bypasses the eager `tensorflow_decision_forests` import for `npm run convert:maest`. Pull the latest repo changes and rerun:

```bash
npm run convert:maest -- /path/to/model.pb /path/to/model.json
```

### I only have an `.onnx` file

That is **not enough** for this app. The renderer expects a **TensorFlow.js graph model** (`model.json` + `group*.bin` shards).

### `npm run setup:models` cannot download labels directly

That is okay. The script now falls back to the official metadata and derives `discogs_519labels.txt` from `metadata.json`.

### The app opens, but genre detection still says unavailable

That means one or more of these is still missing:

- `public/models/essentia-wasm.es.js`
- `public/models/essentia-wasm.module.wasm`
- `public/models/essentia.js-core.es.js`
- `public/models/discogs_519labels.txt`
- `public/models/maest-30s-pw/metadata.json`
- `public/models/maest-30s-pw/model.json`
- the required `group*.bin` shards

Run:

```bash
npm run setup:models
npm run check:models
```

---

## 11. Useful commands

```bash
npm install
npm run setup:python-ml
npm run setup:models
npm run check:models
npm run convert:maest -- /path/to/model.pb /path/to/model.json
npm run dev
npx vite build
```

---

## 12. Project structure

```text
electron/main.js
src/audio/genreDetector.js
src/audio/genreTaxonomy.js
src/dashboard/Dashboard.jsx
src/Home.jsx
scripts/model-assets.mjs
scripts/setup-python-ml.mjs
scripts/convert-maest-frozen-model.mjs
public/models/README.md
```

---

## License

MIT

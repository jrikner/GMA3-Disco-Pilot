# GMA3 Disco Pilot

GMA3 Disco Pilot is an Electron app that listens to music, estimates BPM/energy/genre, and sends OSC commands to GrandMA3.

This README is the **simple install version**: what to download, what to run, and what is optional.

---

## What you need

### Required

- **Node.js LTS**
- **npm** (comes with Node.js)
- This repo

### Optional but recommended

- **Essentia runtime files** for better music analysis
- **Discogs/MAEST label file**
- A **TensorFlow.js MAEST model export** if you want the higher-accuracy model path

### Important note about TensorFlow

You do **not** need to install Python TensorFlow just to run this app.

This app looks for a **TensorFlow.js graph model export** inside `public/models/maest-30s-pw/`:

```text
public/models/maest-30s-pw/model.json
public/models/maest-30s-pw/group*.bin
```

If you do not have those files, the app still works. It just uses the built-in fallback detector.

---

## 1. Download the repo

### Option A: Git

```bash
git clone <YOUR-REPO-URL>
cd GMA3-Disco-Pilot
```

### Option B: ZIP

Download the ZIP from GitHub, extract it, then open a terminal in the extracted `GMA3-Disco-Pilot` folder.

---

## 2. Install Node.js

Install the current **Node.js LTS** release from:

- <https://nodejs.org/>

Check that it worked:

```bash
node -v
npm -v
```

---

## 3. Install app dependencies

From the repo root:

```bash
npm install
```

This installs the app itself.

---

## 4. Install/copy the model runtime files

Run:

```bash
npm run setup:models
```

This helper does the easy part for you:

- installs `essentia.js` locally
- copies `essentia-wasm.es.js`
- copies `essentia-wasm.module.wasm`
- tries to download `discogs_519labels.txt`

Then check what you have:

```bash
npm run check:models
```

After this step, you should usually have:

```text
public/models/essentia-wasm.es.js
public/models/essentia-wasm.module.wasm
public/models/discogs_519labels.txt
```

---

## 5. Add the MAEST TensorFlow model if you have it

If you already have a **TensorFlow.js MAEST export**, copy it here:

```text
public/models/maest-30s-pw/model.json
public/models/maest-30s-pw/group*.bin
```

Then run:

```bash
npm run check:models
```

### If you only have `maest-30s-pw.onnx`

That file alone is **not enough** for this app.

The app currently expects a **TensorFlow.js graph model**, not a raw ONNX file. So:

- `model.json` + `group*.bin` = supported
- `.onnx` by itself = not used by the app

If you do not add the TensorFlow.js export, the app will still run in fallback mode.

---

## 6. Start the app

```bash
npm run dev
```

If the optional model files are missing, the app should still open.

---

## 7. Set up GrandMA3 OSC

In GrandMA3, go to:

`Menu -> System -> Network Protocols -> OSC`

Turn on:

- **OSC Input**
- **OSC Output** on port `8001` if you want feedback back into the app

Also note the IP address of the MA3 machine you want to connect to.

---

## Fast install summary

If you want the shortest possible setup:

```bash
git clone <YOUR-REPO-URL>
cd GMA3-Disco-Pilot
npm install
npm run setup:models
npm run check:models
npm run dev
```

---

## What is optional vs required?

### App can run with only this

```bash
npm install
npm run dev
```

### Better analysis usually needs this too

```bash
npm run setup:models
```

### Highest-accuracy MAEST path needs this too

Add these files manually:

```text
public/models/maest-30s-pw/model.json
public/models/maest-30s-pw/group*.bin
```

---

## Troubleshooting

### `npm run setup:models` worked but there is no `model.json`

That is normal.

The helper script does **not** download or generate the MAEST TensorFlow.js model export. It only prepares the runtime files and label file.

### `npm run check:models` says model files are missing

That usually means one of these is still missing:

- `public/models/essentia-wasm.es.js`
- `public/models/essentia-wasm.module.wasm`
- `public/models/discogs_519labels.txt`
- `public/models/maest-30s-pw/model.json`
- `public/models/maest-30s-pw/group*.bin`

### The app opens but uses fallback mode

That usually means the optional TensorFlow.js MAEST files are not installed yet.

### I only want to use the app without MAEST

That is fine. Install dependencies, run the app, and use the fallback detector.

---

## Useful commands

```bash
npm install
npm run setup:models
npm run check:models
npm run dev
npm run build
```

---

## More detail

If you want the lower-level model asset notes, see:

- [`public/models/README.md`](public/models/README.md)

---

## License

MIT

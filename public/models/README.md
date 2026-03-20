# `public/models/` runtime assets

This directory is intentionally almost empty in Git. The app looks here at runtime for optional Essentia/MAEST files.

## What the app checks for

### Essentia runtime

These files are the minimum runtime bundle for loading Essentia in the browser:

- `essentia-wasm.es.js`
- `essentia-wasm.module.wasm`

### Higher-accuracy MAEST assets

For the full graph-model path, the app also looks for:

- `discogs_519labels.txt`
- `maest-30s-pw/model.json`
- every `maest-30s-pw/group*.bin` shard referenced by `model.json`

## Fastest setup

From the repo root, run:

```bash
npm run setup:models
```

Then inspect the result:

```bash
npm run check:models
```

## What `setup:models` actually downloads

If only the `.onnx` file is present, the app now logs a warning and stays on the spectral fallback path instead of repeatedly throwing inference errors. The loader also verifies that `model.json` is a real TensorFlow.js graph manifest and that every referenced `group*.bin` shard is reachable before enabling Essentia inference.

- install `essentia.js` locally with `npm install --no-save essentia.js`
- copy `node_modules/essentia.js/dist/essentia-wasm.es.js` into this folder
- copy the published `essentia-wasm*.wasm` file into this folder as `essentia-wasm.module.wasm`
- try to download `discogs_519labels.txt` from Hugging Face

It does **not** create `maest-30s-pw/model.json`, because this repo does not include a TensorFlow.js MAEST export.

## Why there is no `.json` here by default

The browser loader in `src/audio/genreDetector.js` expects a TensorFlow.js graph model export, not a standalone ONNX file. So even if you have `maest-30s-pw.onnx`, the app will not use it directly.

If you want full graph inference, either manually place a compatible TensorFlow.js export here or generate one from the official frozen graph + metadata JSON with `npm run convert:maest -- /path/to/model.pb /path/to/model.json`:

```text
public/models/maest-30s-pw/model.json
public/models/maest-30s-pw/group*.bin
```

## Expected outcomes

- **Runtime files missing:** Home shows heuristic mode because Essentia cannot load.
- **Runtime files present, MAEST graph missing:** app still runs, but on the spectral fallback detector.
- **Runtime files + labels + MAEST graph present:** full high-accuracy path can load after restart.

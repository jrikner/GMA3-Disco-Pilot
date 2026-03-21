# `public/models/` runtime assets

This directory is intentionally almost empty in Git. The app looks here at runtime for the Essentia browser runtime and the optional Discogs-MAEST model assets.

## Required Essentia runtime files

The remodeled detector needs all three files below:

- `essentia-wasm.es.js`
- `essentia-wasm.module.wasm`
- `essentia.js-core.es.js`

## Required MAEST assets

For Discogs-MAEST inference, the app also looks for:

- `discogs_519labels.txt`
- `maest-30s-pw/metadata.json`
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

## What `setup:models` does

- copies the browser Essentia runtime from `node_modules/essentia.js/dist/`
- downloads `discogs_519labels.txt`
- downloads the official `discogs-maest-30s-pw-519l-2.json` metadata as `maest-30s-pw/metadata.json`

It does **not** create `maest-30s-pw/model.json`, because the repo does not ship the TensorFlow.js export of the MAEST graph.

## Generating the TensorFlow.js graph

If you have the official frozen graph and metadata JSON, run:

```bash
npm run convert:maest -- /path/to/model.pb /path/to/model.json
```

That command writes:

```text
public/models/discogs_519labels.txt
public/models/maest-30s-pw/metadata.json
public/models/maest-30s-pw/model.json
public/models/maest-30s-pw/group*.bin
```

## Expected outcomes

- **Runtime files missing:** genre detection stays unavailable because Essentia preprocessing cannot load.
- **Runtime ready, graph missing:** audio capture works, but live genre detection cannot start.
- **Runtime + labels + metadata + graph ready:** full Discogs-MAEST path can load after restart.

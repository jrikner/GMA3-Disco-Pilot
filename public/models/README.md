# Essentia.js Model Files

Place the required files in this directory for on-device music genre detection.
Without these files the app falls back to a basic spectral heuristic — still functional but less accurate.

## Required Files

| File | Size | Purpose |
|------|------|---------|
| `essentia-wasm.es.js` | ~2 MB | Essentia.js WebAssembly ES module loader |
| `essentia-wasm.module.wasm` | ~5 MB | Compiled Essentia WASM binary (rename/copy to this filename) |

## Download

1. Go to the [Essentia.js releases](https://mtg.github.io/essentia.js/) page
2. Download the **WASM ES module** build (not the legacy UMD build)
3. Place both files in this directory (`public/models/`)

Alternatively, install via npm and copy:
```bash
npm install essentia.js
cp node_modules/essentia.js/dist/essentia-wasm.es.js public/models/
# Different versions may use a different .wasm filename
WASM_SRC=$(find node_modules/essentia.js/dist -maxdepth 1 -type f -name 'essentia-wasm*.wasm' | head -n 1)
cp "$WASM_SRC" public/models/essentia-wasm.module.wasm
```
If `WASM_SRC` is empty, run `ls node_modules/essentia.js/dist` and copy whichever `essentia-wasm*.wasm` file exists to `public/models/essentia-wasm.module.wasm`.

## MAEST Model (Optional — for higher accuracy)

The app can use the Discogs MAEST-30s model for 519-class music style classification.
The previous README text about TensorFlow.js `model.json` shards was incorrect for this model source.

| File | Size | Notes |
|------|------|-------|
| `discogs-maest-30s-pw-519l-2.pb` | ~348 MB | Official Essentia frozen graph model used by `TensorflowPredictMAEST` |
| `discogs-maest-30s-pw-519l-2.json` | ~23 KB | Official Essentia metadata file with class names and inference metadata |
| `discogs_519labels.txt` | ~6 KB | Optional fallback label list if the metadata JSON is unavailable |

Download with curl:

```bash
mkdir -p public/models
curl -L "https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.pb" \
     -o public/models/discogs-maest-30s-pw-519l-2.pb
curl -L "https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-30s-pw-519l-2.json" \
     -o public/models/discogs-maest-30s-pw-519l-2.json
curl -L "https://huggingface.co/mtg-upf/discogs-maest-30s-pw-129e-519l/resolve/main/discogs_519labels.txt" \
     -o public/models/discogs_519labels.txt
```

Quick verification:

```bash
test -f public/models/discogs-maest-30s-pw-519l-2.pb && \
test -f public/models/discogs-maest-30s-pw-519l-2.json && \
echo "MAEST files look present"
```

Or manually, download these two files from Essentia's model index and place them in `public/models/`:

- `discogs-maest-30s-pw-519l-2.pb`
- `discogs-maest-30s-pw-519l-2.json`

The standalone Hugging Face repo for `mtg-upf/discogs-maest-30s-pw-129e-519l` does **not** expose the browser-ready `model.json` shards mentioned previously. It exposes a Transformers model package instead, so use the Essentia-hosted `.pb` + `.json` files above for this app.

If only the wrong model artifact is present, the app now logs a warning and stays on the spectral fallback path instead of repeatedly throwing inference errors.

Without this model, the app falls back to the spectral heuristic path.

If `discogs_519labels.txt` is missing, the detector can still run but MAEST predictions
cannot be reliably mapped to the internal 8 genres.

## Verification

Once files are in place, restart the app. The dashboard status bar will show
"Essentia loaded" instead of "Heuristic fallback".

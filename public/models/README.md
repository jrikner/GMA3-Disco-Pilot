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

The app can use the Discogs MAEST-30s model for 519-class music style classification:

| File | Size | Notes |
|------|------|-------|
| `maest-30s-pw.onnx` | ~200 MB | ONNX model file |

Download with curl:

```bash
mkdir -p public/models
curl -L "https://huggingface.co/mtg-upf/discogs-maest-30s-pw-129e-519l/resolve/main/maest-30s-pw.onnx" \
     -o public/models/maest-30s-pw.onnx
```

Or manually: go to [https://huggingface.co/mtg-upf/discogs-maest-30s-pw-129e-519l](https://huggingface.co/mtg-upf/discogs-maest-30s-pw-129e-519l), click the **↓** icon next to `maest-30s-pw.onnx`, and move the file here.

Without this model, Essentia's lower-level audio features still improve detection over
the pure spectral heuristic fallback.

## Verification

Once files are in place, restart the app. The dashboard status bar will show
"Essentia loaded" instead of "Heuristic fallback".

# `public/models/` quick guide

This folder is **not** fully committed to Git.

You must add the Essentia runtime files and the converted MAEST TensorFlow.js graph yourself.

---

## 1. Copy the Essentia runtime

From the repo root:

```bash
npm run setup:models
```

That gives you:

```text
public/models/essentia-wasm.es.js
public/models/essentia-wasm.module.wasm
public/models/essentia.js-core.es.js
public/models/discogs_519labels.txt
public/models/maest-30s-pw/metadata.json
```

---

## 2. Convert the official MAEST model

If you are on macOS, create the Python conversion environment first:

```bash
npm run setup:python-ml
```

Use Python `3.9`-`3.12` for this step. If your default Homebrew Python is newer, install a supported version such as:

```bash
brew install python@3.12
```

`brew install python` is helpful for getting Python 3 onto your machine, but it does not install the `tensorflowjs` converter package by itself. The command above creates `.venv-maest` and installs the required pip packages for you.

If `.venv-maest` already exists from an older or incompatible Python install, `npm run setup:python-ml` recreates it automatically.

The setup script also pins a compatible TensorFlow stack for conversion, including `tensorflow-decision-forests==1.12.0`, so pip does not drift to a newer conflicting release.

Then convert the official frozen graph:

```bash
npm run convert:maest -- /path/to/discogs-maest-30s-pw-519l-2.pb /path/to/discogs-maest-30s-pw-519l-2.json
```

That creates:

```text
public/models/maest-30s-pw/model.json
public/models/maest-30s-pw/group*.bin
public/models/maest-30s-pw/metadata.json
```

---

## 3. Verify everything

```bash
npm run check:models
```

You want all four items to be ready:

- Essentia runtime
- Discogs labels
- MAEST metadata
- MAEST TF.js graph

---

## 4. Important note

A standalone `.onnx` file is **not** enough for this app.

The renderer expects the **TensorFlow.js** graph export:

- `model.json`
- every referenced `group*.bin` shard

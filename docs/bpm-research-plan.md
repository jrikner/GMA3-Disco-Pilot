# BPM research plan

## Repos reviewed

- `dlepaux/realtime-bpm-analyzer`
  - Useful ideas: low-pass prefiltering, thresholded peak picking, interval grouping, and returning multiple tempo candidates instead of committing too early.
- `scaperot/the-BPM-detector-python`
  - Useful ideas: build a tempo estimate from a transformed onset/envelope signal rather than raw waveform peaks, then use autocorrelation over a bounded BPM range.
- `tornqvist/bpm-detective`
  - Useful ideas: short-list peaks first, compare multiple peak intervals, fold candidates into a musically useful BPM range, and rank by vote count.
- `michaelkrzyzaniak/Beat-and-Tempo-Tracking`
  - Useful ideas: adaptive onset thresholding using running statistics, generalized autocorrelation of the onset-strength signal, scoring candidate tempos against an ideal pulse train, and smoothing tempo over time with a histogram instead of a single raw estimate.

## Integration direction for this repo

1. Keep Meyda as the real-time feature extractor.
2. Replace the fixed spectral-flux onset gate with a moving mean/std-dev threshold.
3. Estimate tempo from two cooperating signals:
   - onset timestamps via interval clustering
   - an onset-strength envelope via generalized autocorrelation and pulse-train scoring
4. Merge local tempo hypotheses through a small Gaussian tempo histogram before updating the live BPM.
5. Validate using deterministic synthetic drum loops with known BPM before trying live microphone input.

## Why synthetic music first

Known-BPM synthetic loops give exact ground truth, avoid copyright issues, and make regression testing repeatable in CI. Once this baseline is reliable, the same harness can be extended with curated real-song excerpts.

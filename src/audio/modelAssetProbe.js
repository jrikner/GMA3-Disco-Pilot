const DEFAULT_MAEST_LABELS_URL = "/models/discogs_519labels.txt";
const MAEST_GRAPH_FILENAMES = [
  "/models/maest-30s-pw/model.json",
  "/models/maest-30s-pw/model",
  "/models/maest-30s-pw",
  "maest-30s-pw",
];
const HTML_RESPONSE_PATTERN = /<\s*!doctype html|<\s*html[\s>]/i;

export { DEFAULT_MAEST_LABELS_URL, MAEST_GRAPH_FILENAMES };

export async function probeGenreModelAssets() {
  const runtime = await probeEssentiaRuntime();
  const graph = await resolveAvailableMaestGraph();
  const labelsUrl = graph?.labelsUrl || DEFAULT_MAEST_LABELS_URL;
  const labels = await probeLabels(labelsUrl);

  const mode =
    runtime.ready && graph?.filename && labels.ready ? "maest" : "heuristic";

  return {
    mode,
    runtime,
    graph,
    labels,
    labelsUrl,
  };
}

export async function probeEssentiaRuntime() {
  const [moduleReady, wasmReady] = await Promise.all([
    checkStaticAssetAvailability("/models/essentia-wasm.es.js"),
    checkStaticAssetAvailability("/models/essentia-wasm.module.wasm"),
  ]);

  return {
    ready: moduleReady && wasmReady,
    moduleReady,
    wasmReady,
  };
}

export async function probeLabels(labelsUrl = DEFAULT_MAEST_LABELS_URL) {
  try {
    const response = await fetch(labelsUrl, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return { ready: false, count: 0, url: labelsUrl };
    }

    const text = await response.text();
    const count = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length;

    return {
      ready: count > 0,
      count,
      url: labelsUrl,
    };
  } catch {
    return { ready: false, count: 0, url: labelsUrl };
  }
}

export async function resolveAvailableMaestGraph() {
  for (const candidate of MAEST_GRAPH_FILENAMES) {
    const normalizedCandidate = normalizeGraphCandidate(candidate);
    if (!looksLikeHttpPath(normalizedCandidate)) continue;

    try {
      const manifest = await fetchValidGraphManifest(normalizedCandidate);
      if (!manifest) continue;

      const missingWeightShard = await findMissingWeightShard(
        normalizedCandidate,
        manifest,
      );
      if (missingWeightShard) continue;

      return {
        filename: normalizedCandidate,
        manifest,
        labelsUrl: getLabelsUrlFromGraphManifest(manifest),
      };
    } catch {
      // Ignore invalid manifests during probe mode.
    }
  }

  return null;
}

export function normalizeGraphCandidate(candidate) {
  if (!looksLikeHttpPath(candidate)) return null;
  if (candidate.endsWith("/model.json") || candidate.endsWith(".json"))
    return candidate;
  if (candidate.endsWith("/")) return `${candidate}model.json`;
  return `${candidate}/model.json`;
}

export async function fetchValidGraphManifest(candidate) {
  const response = await fetch(candidate, { method: "GET", cache: "no-store" });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();
  const trimmedText = rawText.trim();
  if (!trimmedText) return null;

  if (
    contentType.includes("text/html") ||
    HTML_RESPONSE_PATTERN.test(trimmedText.slice(0, 128))
  ) {
    return null;
  }

  let manifest = null;
  try {
    manifest = JSON.parse(trimmedText);
  } catch {
    throw new Error("response was not valid JSON");
  }

  if (!manifest || typeof manifest !== "object") {
    throw new Error("manifest JSON was empty or malformed");
  }

  const hasModelTopology = "modelTopology" in manifest;
  const weightEntries = Array.isArray(manifest.weightsManifest)
    ? manifest.weightsManifest
    : [];
  const hasWeightPaths = weightEntries.some(
    (entry) => Array.isArray(entry?.paths) && entry.paths.length > 0,
  );
  if (!hasModelTopology || !hasWeightPaths) {
    throw new Error(
      "manifest is missing modelTopology or weightsManifest paths",
    );
  }

  return manifest;
}

export async function findMissingWeightShard(graphFilename, manifest) {
  const shardPaths = Array.from(
    new Set(
      manifest.weightsManifest
        .flatMap((entry) => (Array.isArray(entry?.paths) ? entry.paths : []))
        .filter((value) => typeof value === "string" && value.trim()),
    ),
  );

  for (const shardPath of shardPaths) {
    const resolvedUrl = new URL(
      shardPath,
      new URL(graphFilename, window.location.origin),
    ).href;
    const isAvailable = await checkStaticAssetAvailability(resolvedUrl);
    if (!isAvailable) return shardPath;
  }

  return null;
}

export function getLabelsUrlFromGraphManifest(manifest) {
  const labelFile = manifest?.userDefinedMetadata?.labelsFile;
  if (typeof labelFile !== "string" || !labelFile.trim())
    return DEFAULT_MAEST_LABELS_URL;
  if (labelFile.startsWith("/")) return labelFile;
  return `/models/${labelFile.replace(/^\.\//, "")}`;
}

export async function checkStaticAssetAvailability(url) {
  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
    });
    if (headResponse.ok) {
      const contentType = headResponse.headers.get("content-type") || "";
      return !contentType.includes("text/html");
    }

    if (headResponse.status !== 405) return false;
  } catch {
    // Fall through to GET for environments that do not support HEAD or block it.
  }

  try {
    const getResponse = await fetch(url, { method: "GET", cache: "no-store" });
    if (!getResponse.ok) return false;

    const contentType = getResponse.headers.get("content-type") || "";
    if (contentType.includes("text/html")) return false;
    if (contentType && !contentType.startsWith("text/")) return true;

    const textSample = await getResponse.text().catch(() => "");
    return !HTML_RESPONSE_PATTERN.test(textSample.slice(0, 128));
  } catch {
    return false;
  }
}

function looksLikeHttpPath(candidate) {
  return (
    typeof candidate === "string" &&
    (candidate.startsWith("/") ||
      candidate.startsWith("http://") ||
      candidate.startsWith("https://"))
  );
}

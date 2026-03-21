import React, { useEffect, useMemo, useState } from "react";
import useStore from "./store/appState.js";
import { probeGenreModelAssets } from "./audio/modelAssetProbe.js";

function getModelStatusMessage(modelProbe) {
  if (!modelProbe) {
    return {
      title: "Checking optional Essentia assets…",
      tone: "#64748b",
      body: "Inspecting the browser-visible runtime, labels, and MAEST graph files.",
    };
  }

  if (modelProbe.mode === "maest") {
    return {
      title: "Essentia + MAEST ready for high-accuracy genre detection.",
      tone: "#22c55e",
      body: `Detected runtime files, ${modelProbe.labels.count} labels, and a graph manifest at ${modelProbe.graph.filename}.`,
    };
  }

  if (!modelProbe.runtime.ready) {
    return {
      title:
        "Genre detection will run in heuristic mode until the Essentia runtime is installed.",
      tone: "#f59e0b",
      body: "Run npm run setup:models to copy essentia-wasm.es.js and essentia-wasm.module.wasm into public/models/.",
    };
  }

  if (!modelProbe.graph?.filename) {
    return {
      title:
        "Essentia runtime found, but the MAEST TensorFlow.js graph is still missing.",
      tone: "#f59e0b",
      body: "Add public/models/maest-30s-pw/model.json plus every referenced group*.bin shard, or generate them with npm run convert:maest -- /path/to/model.pb /path/to/model.json.",
    };
  }

  return {
    title:
      "Essentia runtime and graph are present, but label mapping is incomplete.",
    tone: "#f59e0b",
    body: `Add a valid label file at ${modelProbe.labelsUrl} so the 519-class MAEST output can map back to the app genres.`,
  };
}

export default function Home() {
  const { setScreen, updateSession } = useStore();
  const [savedProfiles, setSavedProfiles] = useState([]);
  const [modelProbe, setModelProbe] = useState(null);

  useEffect(() => {
    window.electronAPI?.profileList().then((r) => {
      if (r?.success) setSavedProfiles(r.profiles);
    });

    probeGenreModelAssets()
      .then(setModelProbe)
      .catch(() => {
        setModelProbe({
          mode: "heuristic",
          runtime: { ready: false, moduleReady: false, wasmReady: false },
          graph: null,
          labels: { ready: false, count: 0 },
          labelsUrl: "/models/discogs_519labels.txt",
        });
      });
  }, []);

  const statusMessage = useMemo(
    () => getModelStatusMessage(modelProbe),
    [modelProbe],
  );

  const loadProfile = async (name) => {
    const r = await window.electronAPI?.profileLoad({ name });
    if (r?.success) {
      updateSession({
        ...r.data.session,
        boundaries: r.data.boundaries,
        addressMap: r.data.addressMap,
      });
      setScreen("dashboard");
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#060608",
        color: "#e0e0e0",
        gap: 40,
        WebkitAppRegion: "drag",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🎛</div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "#fff",
            marginBottom: 8,
          }}
        >
          GMA3 Disco Pilot
        </h1>
        <p style={{ color: "#555", fontSize: 14 }}>
          AI-driven music genre lighting controller for GrandMA3
        </p>
      </div>

      <div style={{ display: "flex", gap: 16, WebkitAppRegion: "no-drag" }}>
        <button
          onClick={() => setScreen("wizard")}
          style={{
            padding: "14px 32px",
            background: "#6366f1",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          New Session
        </button>

        {savedProfiles.length > 0 && (
          <div style={{ position: "relative" }}>
            <select
              onChange={(e) => e.target.value && loadProfile(e.target.value)}
              style={{
                padding: "14px 32px",
                background: "#12121a",
                color: "#ccc",
                border: "1px solid #2a2a3a",
                borderRadius: 10,
                fontSize: 15,
                cursor: "pointer",
                appearance: "none",
              }}
            >
              <option value="">Load saved profile…</option>
              {savedProfiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div
        style={{
          maxWidth: 560,
          padding: "14px 18px",
          background: "#11131a",
          border: `1px solid ${statusMessage.tone}55`,
          borderRadius: 12,
          fontSize: 12,
          color: "#aab0c0",
          lineHeight: 1.7,
          WebkitAppRegion: "no-drag",
        }}
      >
        <strong style={{ color: statusMessage.tone }}>
          {statusMessage.title}
        </strong>
        <br />
        {statusMessage.body}
        <br />
        <span>
          Runtime:{" "}
          <code style={{ color: "#e0e0e0" }}>
            {modelProbe?.runtime?.ready ? "ready" : "missing"}
          </code>
          {" · "}
          Graph:{" "}
          <code style={{ color: "#e0e0e0" }}>
            {modelProbe?.graph?.filename || "missing"}
          </code>
          {" · "}
          Labels:{" "}
          <code style={{ color: "#e0e0e0" }}>
            {modelProbe?.labels?.ready
              ? `${modelProbe.labels.count} loaded`
              : "missing"}
          </code>
        </span>
        <br />
        Need help? Run{" "}
        <code
          style={{
            color: "#e0e0e0",
            background: "#1b1e28",
            padding: "1px 5px",
            borderRadius: 3,
          }}
        >
          npm run setup:models
        </code>{" "}
        and follow{" "}
        <code
          style={{
            color: "#e0e0e0",
            background: "#1b1e28",
            padding: "1px 5px",
            borderRadius: 3,
          }}
        >
          public/models/README.md
        </code>
        .
      </div>

      <p style={{ fontSize: 12, color: "#333" }}>
        First time? Start with New Session to configure your MA3 show and
        generate the plugin.
      </p>
    </div>
  );
}

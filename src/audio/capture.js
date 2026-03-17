/**
 * Audio capture via Web Audio API
 * Provides a shared AudioContext and mic stream for BPM and genre detectors.
 */

let audioContext = null
let micStream = null
let sourceNode = null
let silentMonitorNode = null
let currentDeviceId = null

export async function listAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter(d => d.kind === 'audioinput')
}

export async function startCapture(deviceId = null) {
  if (audioContext && sourceNode && currentDeviceId !== deviceId) {
    await stopCapture()
  }

  if (audioContext && sourceNode) {
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
    return { audioContext, sourceNode }
  }

  const strictConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: 44100,
  }
  if (deviceId) strictConstraints.deviceId = { exact: deviceId }

  // Some drivers reject strict sample-rate/device constraints. Retry with a
  // relaxed constraint set so we still get a usable input stream.
  const relaxedConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }
  if (deviceId) relaxedConstraints.deviceId = { exact: deviceId }

  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: strictConstraints })
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ audio: relaxedConstraints })
  }

  micStream = stream
  audioContext = new AudioContext()
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }
  sourceNode = audioContext.createMediaStreamSource(stream)
  currentDeviceId = deviceId

  // Keep the graph alive while remaining silent in local monitors.
  // Some browsers/drivers only run analyzers when an output path exists.
  silentMonitorNode = audioContext.createGain()
  silentMonitorNode.gain.value = 0
  sourceNode.connect(silentMonitorNode)
  silentMonitorNode.connect(audioContext.destination)

  return { audioContext, sourceNode }
}

export async function stopCapture() {
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop())
    micStream = null
  }
  if (audioContext) {
    await audioContext.close()
    audioContext = null
    sourceNode = null
    silentMonitorNode = null
    currentDeviceId = null
  }
}

export function getAudioContext() {
  return audioContext
}

export function getSourceNode() {
  return sourceNode
}

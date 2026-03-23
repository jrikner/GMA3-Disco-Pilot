/**
 * Audio capture via Web Audio API
 * Provides a shared AudioContext and mic stream for BPM and genre detectors.
 */

let audioContext = null
let micStream = null
let sourceNode = null
let inputGainNode = null
let silentMonitorNode = null
let currentDeviceId = null
let currentInputGain = 1.6

const MIN_INPUT_GAIN = 0.25
const MAX_INPUT_GAIN = 8

function clampInputGain(value) {
  return Math.min(MAX_INPUT_GAIN, Math.max(MIN_INPUT_GAIN, value))
}

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
  inputGainNode = audioContext.createGain()
  currentInputGain = clampInputGain(currentInputGain)
  inputGainNode.gain.value = currentInputGain
  currentDeviceId = deviceId

  // Keep the graph alive while remaining silent in local monitors.
  // Some browsers/drivers only run analyzers when an output path exists.
  silentMonitorNode = audioContext.createGain()
  silentMonitorNode.gain.value = 0
  sourceNode.connect(inputGainNode)
  inputGainNode.connect(silentMonitorNode)
  silentMonitorNode.connect(audioContext.destination)

  return { audioContext, sourceNode: inputGainNode, rawSourceNode: sourceNode }
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
    inputGainNode = null
    silentMonitorNode = null
    currentDeviceId = null
  }
}

export function getAudioContext() {
  return audioContext
}

export function getSourceNode() {
  return inputGainNode || sourceNode
}

export function setInputGain(value, { immediate = false } = {}) {
  currentInputGain = clampInputGain(value)

  if (!audioContext || !inputGainNode) {
    return currentInputGain
  }

  const at = audioContext.currentTime
  inputGainNode.gain.cancelScheduledValues(at)
  if (!immediate) {
    inputGainNode.gain.setValueAtTime(inputGainNode.gain.value, at)
    inputGainNode.gain.linearRampToValueAtTime(currentInputGain, at + 0.12)
  } else {
    inputGainNode.gain.setValueAtTime(currentInputGain, at)
  }

  return currentInputGain
}

export function getInputGain() {
  return currentInputGain
}

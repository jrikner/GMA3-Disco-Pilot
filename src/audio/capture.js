/**
 * Audio capture via Web Audio API
 * Provides a shared AudioContext and mic stream for BPM and genre detectors.
 */

let audioContext = null
let micStream = null
let sourceNode = null

export async function listAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter(d => d.kind === 'audioinput')
}

export async function startCapture(deviceId = null) {
  if (audioContext) return { audioContext, sourceNode }

  const audioConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: 44100,
  }
  if (deviceId) audioConstraints.deviceId = { exact: deviceId }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
  })

  micStream = stream
  audioContext = new AudioContext({ sampleRate: 44100 })
  sourceNode = audioContext.createMediaStreamSource(stream)

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
  }
}

export function getAudioContext() {
  return audioContext
}

export function getSourceNode() {
  return sourceNode
}

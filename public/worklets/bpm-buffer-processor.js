class BPMBufferProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super()
    this.chunkSize = options.processorOptions?.chunkSize || 4096
    this.buffer = new Float32Array(this.chunkSize)
    this.offset = 0
  }

  process(inputs) {
    const input = inputs[0]
    const channel = input?.[0]

    if (!channel?.length) return true

    let cursor = 0
    while (cursor < channel.length) {
      const remaining = this.chunkSize - this.offset
      const copyLength = Math.min(remaining, channel.length - cursor)
      this.buffer.set(channel.subarray(cursor, cursor + copyLength), this.offset)
      this.offset += copyLength
      cursor += copyLength

      if (this.offset === this.chunkSize) {
        this.port.postMessage(this.buffer.slice(0))
        this.offset = 0
      }
    }

    return true
  }
}

registerProcessor('bpm-buffer-processor', BPMBufferProcessor)

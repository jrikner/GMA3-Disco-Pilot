class GenreBufferProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const configuredChunkSize = options?.processorOptions?.chunkSize
    this.chunkSize = Number.isInteger(configuredChunkSize) && configuredChunkSize > 0
      ? configuredChunkSize
      : 4096
    this.pending = new Float32Array(this.chunkSize)
    this.pendingIndex = 0
  }

  process(inputs) {
    const inputChannels = inputs[0]
    if (!inputChannels?.length) return true

    const samples = inputChannels[0]
    for (let i = 0; i < samples.length; i++) {
      this.pending[this.pendingIndex++] = samples[i]
      if (this.pendingIndex === this.chunkSize) {
        const chunk = this.pending
        this.pending = new Float32Array(this.chunkSize)
        this.pendingIndex = 0
        this.port.postMessage(chunk.buffer, [chunk.buffer])
      }
    }

    return true
  }
}

registerProcessor('genre-buffer-processor', GenreBufferProcessor)

/**
 * Client-side audio compression utility
 * Compresses audio to stay under Vercel's 4.5MB body limit
 * Uses OfflineAudioContext for high-quality resampling
 */

// Vercel has 4.5MB limit, we target 4MB to be safe
const VERCEL_TARGET_BYTES = 4 * 1024 * 1024

interface CompressionResult {
    blob: Blob
    originalSize: number
    compressedSize: number
    compressionRatio: number
    wasCompressed: boolean
}

/**
 * Decode audio blob to AudioBuffer using Web Audio API
 */
async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
    const arrayBuffer = await blob.arrayBuffer()
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
        return audioBuffer
    } finally {
        await audioContext.close()
    }
}

/**
 * Use OfflineAudioContext for proper high-quality resampling
 * This is the browser-native way to resample audio
 */
async function resampleAudio(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<Float32Array> {
    const numChannels = audioBuffer.numberOfChannels
    const originalSampleRate = audioBuffer.sampleRate
    const duration = audioBuffer.duration

    // Calculate output length
    const outputLength = Math.ceil(duration * targetSampleRate)

    // Create offline context at target sample rate 
    const offlineCtx = new OfflineAudioContext(1, outputLength, targetSampleRate)

    // Create a buffer source
    const source = offlineCtx.createBufferSource()
    source.buffer = audioBuffer

    // Connect directly to destination (automatic resampling happens here)
    source.connect(offlineCtx.destination)
    source.start(0)

    // Render
    const renderedBuffer = await offlineCtx.startRendering()

    // Get mono output
    return renderedBuffer.getChannelData(0)
}

/**
 * Fallback: manual downsampling if OfflineAudioContext fails
 */
function downsampleToMonoManual(audioBuffer: AudioBuffer, targetSampleRate: number): Float32Array {
    const numChannels = audioBuffer.numberOfChannels
    const originalSampleRate = audioBuffer.sampleRate
    const originalLength = audioBuffer.length

    // Mix down to mono first
    const monoData = new Float32Array(originalLength)
    for (let i = 0; i < originalLength; i++) {
        let sum = 0
        for (let channel = 0; channel < numChannels; channel++) {
            sum += audioBuffer.getChannelData(channel)[i]
        }
        monoData[i] = sum / numChannels
    }

    // Resample to target sample rate using linear interpolation
    const ratio = originalSampleRate / targetSampleRate
    const newLength = Math.ceil(originalLength / ratio)
    const resampled = new Float32Array(newLength)

    for (let i = 0; i < newLength; i++) {
        const srcIndex = i * ratio
        const srcIndexFloor = Math.floor(srcIndex)
        const srcIndexCeil = Math.min(srcIndexFloor + 1, originalLength - 1)
        const frac = srcIndex - srcIndexFloor

        // Linear interpolation
        resampled[i] = monoData[srcIndexFloor] * (1 - frac) + monoData[srcIndexCeil] * frac
    }

    return resampled
}

/**
 * Encode Float32Array as 16-bit PCM WAV
 */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(buffer)

    // WAV header
    const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i))
        }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true) // PCM chunk size
    view.setUint16(20, 1, true) // Audio format (1 = PCM)
    view.setUint16(22, 1, true) // Number of channels (1 = mono)
    view.setUint32(24, sampleRate, true) // Sample rate
    view.setUint32(28, sampleRate * 2, true) // Byte rate (sampleRate * channels * bytesPerSample)
    view.setUint16(32, 2, true) // Block align (channels * bytesPerSample)
    view.setUint16(34, 16, true) // Bits per sample
    writeString(36, 'data')
    view.setUint32(40, samples.length * 2, true) // Data chunk size

    // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
    let offset = 44
    for (let i = 0; i < samples.length; i++) {
        // Clamp to [-1, 1]
        const sample = Math.max(-1, Math.min(1, samples[i]))
        // Convert to 16-bit signed integer
        const int16 = Math.round(sample * 32767)
        view.setInt16(offset, int16, true)
        offset += 2
    }

    return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Main compression function - compresses audio for Vercel upload
 * Always compresses to ensure it works, with validation
 */
export async function compressAudioForUpload(blob: Blob): Promise<CompressionResult> {
    const originalSize = blob.size

    // Always compress to test the compression pipeline
    // TODO: After testing, can add back the size check to skip small files

    console.log(`[AudioCompressor] Compressing file of size ${(originalSize / 1024 / 1024).toFixed(2)}MB...`)

    try {
        // Decode audio
        const audioBuffer = await decodeAudioBlob(blob)
        const durationSeconds = audioBuffer.duration
        console.log(`[AudioCompressor] Decoded: ${durationSeconds.toFixed(1)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.length} samples`)

        // Validate the audio buffer has content
        if (durationSeconds < 0.1 || audioBuffer.length === 0) {
            throw new Error('Audio buffer is empty or too short')
        }

        // Check if audio has actual content (not just silence)
        const channelData = audioBuffer.getChannelData(0)
        let maxAmplitude = 0
        let sumSquares = 0
        const checkLength = Math.min(channelData.length, 50000)
        for (let i = 0; i < checkLength; i++) {
            const val = Math.abs(channelData[i])
            maxAmplitude = Math.max(maxAmplitude, val)
            sumSquares += channelData[i] * channelData[i]
        }
        const rms = Math.sqrt(sumSquares / checkLength)
        console.log(`[AudioCompressor] Audio stats - Max: ${maxAmplitude.toFixed(4)}, RMS: ${rms.toFixed(4)}`)

        if (maxAmplitude < 0.001) {
            throw new Error('Audio appears to be silent')
        }

        // Adaptive sample rate based on duration to stay under 4MB limit
        // WAV at 16kHz mono 16-bit = 32KB/sec = ~1.92MB/min
        // WAV at 8kHz mono 16-bit = 16KB/sec = ~0.96MB/min
        // For 4MB: 16kHz = ~2min, 8kHz = ~4min safely
        let targetSampleRate: number
        if (durationSeconds > 240) {
            targetSampleRate = 8000 // 4+ min -> 8kHz
        } else if (durationSeconds > 120) {
            targetSampleRate = 12000 // 2-4 min -> 12kHz
        } else {
            targetSampleRate = 16000 // < 2 min -> 16kHz
        }

        console.log(`[AudioCompressor] Using ${targetSampleRate}Hz for ${durationSeconds.toFixed(0)}s audio`)

        // Resample using OfflineAudioContext (browser-native, high quality)
        let samples: Float32Array
        try {
            samples = await resampleAudio(audioBuffer, targetSampleRate)
            console.log(`[AudioCompressor] Resampled with OfflineAudioContext: ${samples.length} samples`)
        } catch (resampleError) {
            console.warn('[AudioCompressor] OfflineAudioContext failed, using manual resampling:', resampleError)
            samples = downsampleToMonoManual(audioBuffer, targetSampleRate)
            console.log(`[AudioCompressor] Resampled manually: ${samples.length} samples`)
        }

        // Validate resampled audio
        let resampledMax = 0
        for (let i = 0; i < Math.min(samples.length, 10000); i++) {
            resampledMax = Math.max(resampledMax, Math.abs(samples[i]))
        }
        console.log(`[AudioCompressor] Resampled max amplitude: ${resampledMax.toFixed(4)}`)

        if (resampledMax < 0.0001) {
            throw new Error('Resampled audio is silent - compression failed')
        }

        // Encode as WAV
        const wavBlob = encodeWav(samples, targetSampleRate)
        const compressedSize = wavBlob.size
        const compressionRatio = originalSize / compressedSize

        console.log(`[AudioCompressor] Compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressedSize / 1024 / 1024).toFixed(2)}MB (${compressionRatio.toFixed(1)}x ratio)`)

        // Final size check
        if (compressedSize > VERCEL_TARGET_BYTES) {
            console.warn(`[AudioCompressor] Still over limit! May need lower sample rate.`)
        }

        return {
            blob: wavBlob,
            originalSize,
            compressedSize,
            compressionRatio,
            wasCompressed: true,
        }
    } catch (error) {
        console.error('[AudioCompressor] Compression failed:', error)
        // Return original blob - let the server handle it or fail gracefully
        return {
            blob,
            originalSize,
            compressedSize: originalSize,
            compressionRatio: 1,
            wasCompressed: false,
        }
    }
}

/**
 * Check if audio compression is supported in this browser
 */
export function isAudioCompressionSupported(): boolean {
    return typeof window !== 'undefined' &&
        (typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined') &&
        typeof OfflineAudioContext !== 'undefined'
}

/**
 * Get maximum recommended recording duration
 * With 8kHz, we can safely do ~4 minutes under 4MB
 */
export function getRecommendedMaxDurationMs(): number {
    return 4 * 60 * 1000 // 4 minutes for safe compression
}

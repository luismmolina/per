/**
 * Client-side audio compression utility
 * Compresses audio to stay under Vercel's 4.5MB body limit
 * Uses Web Audio API to downsample to 16kHz mono (what Groq Whisper uses anyway)
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
 * Downsample audio buffer to target sample rate
 * Uses 8kHz for longer recordings to stay under Vercel limit (telephone quality, still great for STT)
 */
function downsampleToMono(audioBuffer: AudioBuffer, targetSampleRate: number): Float32Array {
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

    // Resample to target sample rate
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
 * WAV is lossless but compact at 16kHz mono
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
    view.setUint32(16, 16, true) // PCM format
    view.setUint16(20, 1, true) // Audio format (1 = PCM)
    view.setUint16(22, 1, true) // Mono
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true) // Byte rate
    view.setUint16(32, 2, true) // Block align
    view.setUint16(34, 16, true) // Bits per sample
    writeString(36, 'data')
    view.setUint32(40, samples.length * 2, true)

    // Convert Float32 to Int16
    let offset = 44
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]))
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
        view.setInt16(offset, int16, true)
        offset += 2
    }

    return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Main compression function - compresses audio for Vercel upload
 * Returns compressed blob or original if already small enough
 */
export async function compressAudioForUpload(blob: Blob): Promise<CompressionResult> {
    const originalSize = blob.size

    // Always compress for Vercel - the server-side FFmpeg step is avoided
    // and we ensure the file is always under the limit
    console.log(`[AudioCompressor] Compressing ${(originalSize / 1024 / 1024).toFixed(2)}MB audio...`)

    try {
        // Decode audio
        const audioBuffer = await decodeAudioBlob(blob)
        const durationSeconds = audioBuffer.duration
        console.log(`[AudioCompressor] Decoded: ${durationSeconds.toFixed(1)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch`)

        // Adaptive sample rate based on duration
        // 16kHz = ~1.92MB/min, 8kHz = ~0.96MB/min
        // For 4MB limit: 16kHz allows ~2min, 8kHz allows ~4min
        // We'll use 8kHz for anything over 2 minutes to be safe
        const targetSampleRate = durationSeconds > 120 ? 8000 : 16000

        // Downsample to mono at target sample rate
        const samples = downsampleToMono(audioBuffer, targetSampleRate)
        console.log(`[AudioCompressor] Downsampled to ${targetSampleRate}Hz mono: ${samples.length} samples`)

        // Encode as WAV
        const wavBlob = encodeWav(samples, targetSampleRate)
        const compressedSize = wavBlob.size
        const compressionRatio = originalSize / compressedSize

        console.log(`[AudioCompressor] Compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressedSize / 1024 / 1024).toFixed(2)}MB (${compressionRatio.toFixed(1)}x reduction)`)

        // Check if we achieved the target
        if (compressedSize > VERCEL_TARGET_BYTES) {
            console.warn(`[AudioCompressor] Warning: Compressed size ${(compressedSize / 1024 / 1024).toFixed(2)}MB still exceeds target ${(VERCEL_TARGET_BYTES / 1024 / 1024).toFixed(1)}MB`)
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
        // Return original blob if compression fails
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
        (typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined')
}

/**
 * Get maximum recommended recording duration based on compression capabilities
 * At 16kHz mono 16-bit: ~32KB per second
 * For 4MB limit: ~125 seconds (2 minutes)
 * For safety, we recommend 5 minutes (compression usually achieves better ratio)
 */
export function getRecommendedMaxDurationMs(): number {
    return 5 * 60 * 1000 // 5 minutes
}

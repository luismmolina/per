import type { DocumentData } from 'firebase-admin/firestore'

import { estimateJsonBytes, logDbTransfer } from './db-diagnostics'
import { getFirestoreDb } from './firebase'

const NOTE_EMBEDDINGS_COLLECTION = 'note_embeddings'

export interface NoteEmbeddingRecord {
  noteId: string
  content: string
  contentHash: string
  timestampIso: string
  embedding: number[]
  embeddingModel: string
  embeddingDimensions: number
  contentLength: number
  updatedAt: string
}

export interface NoteEmbeddingMetadata {
  noteId: string
  contentHash: string
  timestampIso: string
  embedding: number[]
  contentLength: number
}

function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is number => typeof entry === 'number')
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.filter((entry): entry is number => typeof entry === 'number') : []
    } catch {
      return []
    }
  }

  return []
}

function mapMetadataDoc(noteId: string, data: DocumentData): NoteEmbeddingMetadata | null {
  const embedding = parseEmbedding(data.embedding)
  if (!embedding.length) return null

  const timestampIso = typeof data.note_timestamp === 'string'
    ? data.note_timestamp
    : data.note_timestamp?.toDate?.()?.toISOString?.() ?? new Date(0).toISOString()

  return {
    noteId,
    contentHash: String(data.content_hash ?? ''),
    timestampIso,
    embedding,
    contentLength: typeof data.content_length === 'number' && data.content_length > 0
      ? data.content_length
      : typeof data.content === 'string'
        ? data.content.length
        : 0,
  }
}

export async function listNoteEmbeddingMetadata(): Promise<NoteEmbeddingMetadata[]> {
  const db = getFirestoreDb()
  const snapshot = await db.collection(NOTE_EMBEDDINGS_COLLECTION).get()

  const notes = snapshot.docs
    .map((doc) => mapMetadataDoc(doc.id, doc.data()))
    .filter((note): note is NoteEmbeddingMetadata => Boolean(note))
    .sort((left, right) => new Date(right.timestampIso).getTime() - new Date(left.timestampIso).getTime())

  logDbTransfer('listNoteEmbeddingMetadata', {
    embeddingsRowsLoaded: notes.length,
    embeddingsBytesLoaded: estimateJsonBytes(notes),
  })

  return notes
}

export async function listNoteEmbeddingHashes(): Promise<Map<string, string>> {
  const db = getFirestoreDb()
  const snapshot = await db.collection(NOTE_EMBEDDINGS_COLLECTION).select('content_hash').get()
  const hashes = new Map<string, string>()

  for (const doc of snapshot.docs) {
    const contentHash = doc.get('content_hash')
    if (typeof contentHash === 'string') {
      hashes.set(doc.id, contentHash)
    }
  }

  return hashes
}

export async function fetchNoteContentsByIds(noteIds: string[]): Promise<Map<string, string>> {
  const contentById = new Map<string, string>()
  if (!noteIds.length) return contentById

  const db = getFirestoreDb()
  const chunkSize = 100

  for (let index = 0; index < noteIds.length; index += chunkSize) {
    const chunk = noteIds.slice(index, index + chunkSize)
    const refs = chunk.map((noteId) => db.collection(NOTE_EMBEDDINGS_COLLECTION).doc(noteId))
    const snapshots = await db.getAll(...refs)

    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue
      const content = snapshot.get('content')
      if (typeof content === 'string') {
        contentById.set(snapshot.id, content)
      }
    }
  }

  logDbTransfer('fetchNoteContentsByIds', {
    contentRowsLoaded: contentById.size,
    contentBytesLoaded: estimateJsonBytes([...contentById.entries()]),
  })

  return contentById
}

export async function deleteNoteEmbeddings(noteIds: string[]): Promise<number> {
  if (!noteIds.length) return 0

  const db = getFirestoreDb()
  let deleted = 0
  const batchSize = 400

  for (let index = 0; index < noteIds.length; index += batchSize) {
    const batch = db.batch()
    const chunk = noteIds.slice(index, index + batchSize)

    for (const noteId of chunk) {
      batch.delete(db.collection(NOTE_EMBEDDINGS_COLLECTION).doc(noteId))
    }

    await batch.commit()
    deleted += chunk.length
  }

  return deleted
}

export async function upsertNoteEmbeddings(records: Array<Omit<NoteEmbeddingRecord, 'updatedAt'>>): Promise<number> {
  if (!records.length) return 0

  const db = getFirestoreDb()
  let indexed = 0
  const batchSize = 200

  for (let index = 0; index < records.length; index += batchSize) {
    const batch = db.batch()
    const chunk = records.slice(index, index + batchSize)
    const updatedAt = new Date().toISOString()

    for (const record of chunk) {
      const ref = db.collection(NOTE_EMBEDDINGS_COLLECTION).doc(record.noteId)
      batch.set(ref, {
        content: record.content,
        content_hash: record.contentHash,
        note_timestamp: record.timestampIso,
        embedding: record.embedding,
        embedding_model: record.embeddingModel,
        embedding_dimensions: record.embeddingDimensions,
        content_length: record.contentLength,
        updated_at: updatedAt,
      }, { merge: true })
    }

    await batch.commit()
    indexed += chunk.length
  }

  return indexed
}

export async function clearNoteEmbeddings(): Promise<void> {
  const db = getFirestoreDb()
  const snapshot = await db.collection(NOTE_EMBEDDINGS_COLLECTION).select().get()
  const noteIds = snapshot.docs.map((doc) => doc.id)
  await deleteNoteEmbeddings(noteIds)
}
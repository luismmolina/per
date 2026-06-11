import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

let _db: Firestore | null = null

interface ServiceAccountCredentials {
  project_id: string
  client_email: string
  private_key: string
}

function parseServiceAccount(raw: string): ServiceAccountCredentials {
  const parsed = JSON.parse(raw) as ServiceAccountCredentials

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('Firebase service account JSON is missing required fields.')
  }

  return parsed
}

function getServiceAccount(): ServiceAccountCredentials {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    return parseServiceAccount(decoded)
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  if (serviceAccountPath) {
    const absolutePath = resolve(process.cwd(), serviceAccountPath)
    return parseServiceAccount(readFileSync(absolutePath, 'utf8'))
  }

  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey,
    }
  }

  throw new Error(
    'Firebase Admin credentials missing. For Vercel use FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY. For local dev use FIREBASE_SERVICE_ACCOUNT_PATH.',
  )
}

export function getFirestoreDb(): Firestore {
  if (_db) return _db

  if (!getApps().length) {
    const serviceAccount = getServiceAccount()
    initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key,
      }),
    })
  }

  _db = getFirestore()
  return _db
}
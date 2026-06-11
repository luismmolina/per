const fs = require('fs')
const path = require('path')

const jsonPath = process.argv[2]
  || process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || 'scheduler-110e4-firebase-adminsdk-za56l-5118971862.json'

const absolutePath = path.resolve(process.cwd(), jsonPath)

if (!fs.existsSync(absolutePath)) {
  console.error(`Service account file not found: ${absolutePath}`)
  process.exit(1)
}

const serviceAccount = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
const privateKeyOneLine = serviceAccount.private_key.replace(/\n/g, '\\n')
const base64 = Buffer.from(JSON.stringify(serviceAccount), 'utf8').toString('base64')

console.log('Paste these into Vercel Environment Variables (no real newlines needed):\n')
console.log('--- Option A: three separate vars (recommended) ---')
console.log(`FIREBASE_PROJECT_ID=${serviceAccount.project_id}`)
console.log(`FIREBASE_CLIENT_EMAIL=${serviceAccount.client_email}`)
console.log(`FIREBASE_PRIVATE_KEY=${privateKeyOneLine}`)
console.log('\n--- Option B: single base64 var ---')
console.log(`FIREBASE_SERVICE_ACCOUNT_BASE64=${base64}`)
console.log('\nDo not use FIREBASE_SERVICE_ACCOUNT_JSON on Vercel unless it is minified to one line.')
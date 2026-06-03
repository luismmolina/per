const { neon } = require('@neondatabase/serverless');
const fs = require('fs');

const dbUrl = process.env.DATABASE_URL;
const sql = neon(dbUrl);

function parseBackupFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const messages = [];
  let currentNote = null;

  const timestampRegex = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))\]\s*(.*)/;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) continue;
    if (trimmed.startsWith('===') || trimmed.startsWith('Total messages') ||
        trimmed.startsWith('Notes found') || trimmed.startsWith('Exported') ||
        trimmed.startsWith('===================================================')) continue;

    const match = trimmed.match(timestampRegex);
    if (match) {
      if (currentNote) messages.push(currentNote);

      const timestampStr = match[1];
      const noteContent = match[2].trim();

      let date;
      try {
        const parts = timestampStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (parts) {
          let month = parseInt(parts[1]) - 1;
          let day = parseInt(parts[2]);
          let year = parseInt(parts[3]);
          if (year < 100) year += 2000;
          let hour = parseInt(parts[4]);
          const minute = parseInt(parts[5]);
          const ampm = parts[6].toUpperCase();
          if (ampm === 'PM' && hour !== 12) hour += 12;
          if (ampm === 'AM' && hour === 12) hour = 0;
          date = new Date(year, month, day, hour, minute);
        } else {
          date = new Date(timestampStr);
        }
      } catch { date = new Date(); }
      if (isNaN(date.getTime())) date = new Date();

      currentNote = {
        id: `restore-${date.getTime()}-${messages.length}`,
        content: noteContent,
        type: 'note',
        timestamp: date.toISOString(),
        source: 'notes-file'
      };
    } else if (currentNote) {
      const continuation = trimmed.trim();
      if (continuation) currentNote.content += '\n' + continuation;
    }
  }
  if (currentNote) messages.push(currentNote);
  return messages;
}

async function restore() {
  // 1. Load existing messages from DB
  const conv = await sql`SELECT data FROM conversations WHERE id = 'contextual-conversations'`;
  const existingMessages = Array.isArray(conv[0]?.data?.messages) ? conv[0].data.messages : [];
  console.log(`Existing messages in DB: ${existingMessages.length}`);

  // 2. Load from notes files
  const allBackupNotes = [];
  const files = ['notes-2026-03-15.txt', 'notes-2026-06-03.txt'];
  
  for (const f of files) {
    if (fs.existsSync(f)) {
      const notes = parseBackupFile(f);
      console.log(`Parsed ${notes.length} notes from ${f}`);
      allBackupNotes.push(...notes);
    }
  }

  // 3. Merge: deduplicate by content prefix
  const messageMap = new Map();

  for (const m of existingMessages) {
    const contentPrefix = (m.content || '').trim().substring(0, 200);
    const key = `${m.type || 'note'}:${contentPrefix}`;
    if (!messageMap.has(key)) messageMap.set(key, m);
  }

  let addedFromFiles = 0;
  for (const m of allBackupNotes) {
    const contentPrefix = m.content.trim().substring(0, 200);
    const key = `${m.type}:${contentPrefix}`;
    if (!messageMap.has(key)) {
      messageMap.set(key, m);
      addedFromFiles++;
    }
  }

  console.log(`Added ${addedFromFiles} new messages from backup files`);

  const mergedMessages = [...messageMap.values()].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  console.log(`Total after merge: ${mergedMessages.length} messages`);

  const types = {};
  for (const m of mergedMessages) { types[m.type] = (types[m.type] || 0) + 1; }
  console.log(`Type breakdown: ${JSON.stringify(types)}`);
  console.log(`Date range: ${mergedMessages[0]?.timestamp} to ${mergedMessages[mergedMessages.length - 1]?.timestamp}`);

  // Show first and last
  console.log('\nFirst 3:');
  mergedMessages.slice(0, 3).forEach((m, i) => {
    console.log(`  [${i}] type=${m.type} ts=${m.timestamp} id=${m.id} content="${String(m.content).substring(0, 80)}..."`);
  });
  console.log('Last 3:');
  mergedMessages.slice(-3).forEach((m, i) => {
    console.log(`  [${mergedMessages.length - 3 + i}] type=${m.type} ts=${m.timestamp} id=${m.id} content="${String(m.content).substring(0, 80)}..."`);
  });

  // Save
  const conversationData = {
    messages: mergedMessages,
    lastUpdated: new Date().toISOString(),
    totalMessages: mergedMessages.length
  };

  const jsonData = typeof sql.json === 'function' ? sql.json(conversationData) : JSON.stringify(conversationData);
  await sql`
    INSERT INTO conversations (id, data, updated_at)
    VALUES ('contextual-conversations', ${jsonData}::jsonb, now())
    ON CONFLICT (id) DO UPDATE
      SET data = excluded.data,
          updated_at = now()
  `;

  console.log(`\nSaved ${mergedMessages.length} messages to database!`);
  process.exit(0);
}

restore().catch(e => { console.error(e); process.exit(1) });
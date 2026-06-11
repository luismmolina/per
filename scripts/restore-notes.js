const fs = require("fs");
const path = require("path");

// Function to parse the timestamp from the notes file format
function parseTimestamp(timestampStr) {
  // Format: [Jun 28, 2025, 02:51 PM]
  const match = timestampStr.match(/\[(.*?)\]/);
  if (!match) return null;

  const dateStr = match[1];
  // Convert "Jun 28, 2025, 02:51 PM" to a proper date
  const date = new Date(dateStr);
  return date;
}

// Function to parse the notes file and extract individual notes
function parseNotesFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const notes = [];
  let currentNote = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) continue;

    // Check if this line starts with a timestamp
    if (line.startsWith("[") && line.includes("]")) {
      // If we have a previous note, save it
      if (currentNote) {
        notes.push(currentNote);
      }

      // Start a new note
      const timestamp = parseTimestamp(line);
      const content = line.substring(line.indexOf("]") + 1).trim();

      currentNote = {
        id: `restored-note-${Date.now()}-${notes.length}`,
        content: content,
        type: "note",
        timestamp: timestamp
          ? timestamp.toISOString()
          : new Date().toISOString(),
        source: "Restored from notes file",
      };
    } else if (currentNote) {
      // This is a continuation of the current note
      currentNote.content += "\n" + line;
    }
  }

  // Don't forget the last note
  if (currentNote) {
    notes.push(currentNote);
  }

  return notes;
}

function hasFirebaseConfig() {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      (process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY)
  );
}

async function getFirestoreDb() {
  const { cert, getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      initializeApp({ credential: cert(serviceAccount) });
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const fs = await import("fs");
      const path = await import("path");
      const absolutePath = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      const serviceAccount = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      });
    }
  }

  return getFirestore();
}

// Function to save notes to the database (Firebase primary, file fallback)
async function saveNotesToDatabase(notes) {

  // File-based storage functions
  const LOCAL_FILE_PATH = path.join(
    process.cwd(),
    "data",
    "conversations.json"
  );

  const ensureDataDirectory = async () => {
    const dataDir = path.dirname(LOCAL_FILE_PATH);
    try {
      await fs.promises.access(dataDir);
    } catch {
      await fs.promises.mkdir(dataDir, { recursive: true });
    }
  };

  const loadFromFile = async () => {
    try {
      await ensureDataDirectory();
      const data = await fs.promises.readFile(LOCAL_FILE_PATH, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      return { messages: [] };
    }
  };

  const saveToFile = async (data) => {
    try {
      await ensureDataDirectory();
      await fs.promises.writeFile(
        LOCAL_FILE_PATH,
        JSON.stringify(data, null, 2)
      );
    } catch (error) {
      console.error("Failed to save to file:", error);
      throw error;
    }
  };

  try {
    // Load existing conversations
    let conversations;
    if (hasFirebaseConfig()) {
      console.log("📝 Using Firebase for restoring notes...");
      const db = await getFirestoreDb();
      const snapshot = await db.collection("conversations").doc("contextual-conversations").get();
      conversations = snapshot.exists ? snapshot.data() : { messages: [] };
      if (!Array.isArray(conversations.messages)) {
        conversations.messages = [];
      }
    } else {
      console.log("📝 Using file storage for restoring notes...");
      conversations = await loadFromFile();
    }

    // Add the restored notes to existing messages
    conversations.messages = [...conversations.messages, ...notes];
    conversations.lastUpdated = new Date().toISOString();
    conversations.totalMessages = conversations.messages.length;

    // Save back to database
    if (hasFirebaseConfig()) {
      const db = await getFirestoreDb();
      await db.collection("conversations").doc("contextual-conversations").set(conversations, { merge: false });
      console.log("✅ Successfully restored notes to Firebase");
    } else {
      await saveToFile(conversations);
      console.log("✅ Successfully restored notes to file storage");
    }

    return true;
  } catch (error) {
    console.error("❌ Failed to save notes to database:", error);
    return false;
  }
}

// Main restoration function
async function restoreNotes() {
  try {
    console.log("🔄 Starting notes restoration process...");

    // Path to the notes file
    const notesFilePath = path.join(process.cwd(), "notes-2025-07-29.txt");

    // Check if the file exists
    if (!fs.existsSync(notesFilePath)) {
      console.error("❌ Notes file not found:", notesFilePath);
      return false;
    }

    console.log("📖 Parsing notes file...");
    const notes = parseNotesFile(notesFilePath);

    console.log(`📊 Found ${notes.length} notes to restore`);

    if (notes.length === 0) {
      console.log("⚠️ No notes found to restore");
      return false;
    }

    // Display sample of notes being restored
    console.log("\n📝 Sample of notes being restored:");
    notes.slice(0, 3).forEach((note, index) => {
      console.log(
        `${index + 1}. [${note.timestamp}] ${note.content.substring(0, 100)}...`
      );
    });

    if (notes.length > 3) {
      console.log(`... and ${notes.length - 3} more notes`);
    }

    // Save to database
    console.log("\n💾 Saving notes to database...");
    const success = await saveNotesToDatabase(notes);

    if (success) {
      console.log("\n✅ Notes restoration completed successfully!");
      console.log(`📊 Total notes restored: ${notes.length}`);
      return true;
    } else {
      console.log("\n❌ Notes restoration failed");
      return false;
    }
  } catch (error) {
    console.error("❌ Error during notes restoration:", error);
    return false;
  }
}

// Run the restoration if this script is executed directly
if (require.main === module) {
  restoreNotes()
    .then((success) => {
      if (success) {
        console.log("\n🎉 Notes restoration completed successfully!");
        process.exit(0);
      } else {
        console.log("\n💥 Notes restoration failed");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("💥 Unexpected error:", error);
      process.exit(1);
    });
}

module.exports = { restoreNotes, parseNotesFile };

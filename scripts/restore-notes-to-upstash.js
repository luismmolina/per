const fs = require("fs");
const path = require("path");

// Upstash Redis configuration
const UPSTASH_CONFIG = {
  url: "https://touching-sawfish-37071.upstash.io",
  token: "AZDPAAIjcDE4NDVkMTliZGIzOWM0NGE5OGUzZTlkNzc3MTI4MmYwZnAxMA",
};

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

// Function to save notes to Upstash Redis
async function saveNotesToUpstash(notes) {
  try {
    console.log("🔗 Connecting to Upstash Redis...");

    const conversationData = {
      messages: notes,
      lastUpdated: new Date().toISOString(),
      totalMessages: notes.length,
    };

    // Create Redis client using Upstash REST API
    const response = await fetch(
      `${UPSTASH_CONFIG.url}/set/contextual-conversations`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${UPSTASH_CONFIG.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(conversationData),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to save to Upstash: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const result = await response.json();
    console.log("✅ Successfully saved notes to Upstash Redis");
    console.log("📊 Response:", result);
    return true;
  } catch (error) {
    console.error("❌ Failed to save notes to Upstash:", error);
    return false;
  }
}

// Function to verify notes are saved to Upstash
async function verifyUpstashNotes() {
  try {
    console.log("🔍 Verifying notes in Upstash Redis...");

    const response = await fetch(
      `${UPSTASH_CONFIG.url}/get/contextual-conversations`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${UPSTASH_CONFIG.token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to read from Upstash: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const result = await response.json();
    console.log("📊 Raw response from Upstash:", result);

    const conversations = result.result;

    if (conversations && conversations.messages) {
      console.log(
        `✅ Verified: ${conversations.messages.length} notes in Upstash Redis`
      );
      console.log(`📊 Total messages: ${conversations.totalMessages}`);
      console.log(`⏰ Last updated: ${conversations.lastUpdated}`);

      // Show sample of restored notes
      console.log("\n📝 Sample of restored notes in Upstash:");
      conversations.messages.slice(0, 3).forEach((note, index) => {
        console.log(
          `${index + 1}. [${note.timestamp}] ${note.content.substring(
            0,
            80
          )}...`
        );
      });

      return true;
    } else {
      console.log("⚠️ No conversations found in Upstash Redis");
      console.log("🔍 Available data:", conversations);
      return false;
    }
  } catch (error) {
    console.error("❌ Failed to verify Upstash notes:", error);
    return false;
  }
}

// Main restoration function
async function restoreNotesToUpstash() {
  try {
    console.log("🔄 Starting notes restoration to Upstash Redis...");

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

    // Save to Upstash Redis
    console.log("\n💾 Saving notes to Upstash Redis...");
    const success = await saveNotesToUpstash(notes);

    if (success) {
      console.log("\n✅ Notes restoration to Upstash completed successfully!");
      console.log(`📊 Total notes restored: ${notes.length}`);

      // Verify the notes are saved
      await verifyUpstashNotes();

      return true;
    } else {
      console.log("\n❌ Notes restoration to Upstash failed");
      return false;
    }
  } catch (error) {
    console.error("❌ Error during notes restoration to Upstash:", error);
    return false;
  }
}

// Run the restoration if this script is executed directly
if (require.main === module) {
  restoreNotesToUpstash()
    .then((success) => {
      if (success) {
        console.log(
          "\n🎉 Notes restoration to Upstash completed successfully!"
        );
        process.exit(0);
      } else {
        console.log("\n💥 Notes restoration to Upstash failed");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("💥 Unexpected error:", error);
      process.exit(1);
    });
}

module.exports = { restoreNotesToUpstash, parseNotesFile };

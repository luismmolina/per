const { restoreNotes, parseNotesFile } = require("./restore-notes");
const fs = require("fs");
const path = require("path");

async function testRestoreNotes() {
  console.log("🧪 Testing notes restoration functionality...\n");

  // Test 1: Parse notes file
  console.log("📖 Test 1: Parsing notes file...");
  const notesFilePath = path.join(process.cwd(), "notes-2025-07-29.txt");

  if (!fs.existsSync(notesFilePath)) {
    console.error("❌ Notes file not found for testing");
    return false;
  }

  try {
    const notes = parseNotesFile(notesFilePath);
    console.log(`✅ Successfully parsed ${notes.length} notes`);

    // Show sample of parsed notes
    console.log("\n📝 Sample parsed notes:");
    notes.slice(0, 2).forEach((note, index) => {
      console.log(`${index + 1}. ID: ${note.id}`);
      console.log(`   Timestamp: ${note.timestamp}`);
      console.log(`   Content: ${note.content.substring(0, 80)}...`);
      console.log(`   Type: ${note.type}`);
      console.log(`   Source: ${note.source}\n`);
    });
  } catch (error) {
    console.error("❌ Failed to parse notes file:", error);
    return false;
  }

  // Test 2: Check if we can connect to Postgres
  console.log("🔗 Test 2: Checking Postgres connectivity...");
  try {
    if (process.env.DATABASE_URL) {
      const mod = await import("@neondatabase/serverless");
      mod.neonConfig.fetchConnectionCache = true;
      const sql = mod.neon(process.env.DATABASE_URL);
      const rows = await sql`select 1 as ok`;
      if (rows[0]?.ok === 1) {
        console.log("✅ Postgres connection successful");
      } else {
        console.log("❌ Postgres connectivity test returned unexpected result:", rows);
        return false;
      }
    } else {
      console.log("ℹ️ DATABASE_URL not set, will use file storage");
    }
  } catch (error) {
    console.error("❌ Database connectivity test failed:", error);
    return false;
  }

  // Test 3: Test the full restoration process (dry run)
  console.log("\n🔄 Test 3: Testing full restoration process...");
  console.log("⚠️ This will actually restore the notes to your database!");
  console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...");

  // Wait 5 seconds to give user time to cancel
  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    const success = await restoreNotes();

    if (success) {
      console.log("✅ Full restoration test completed successfully!");
      return true;
    } else {
      console.log("❌ Full restoration test failed");
      return false;
    }
  } catch (error) {
    console.error("❌ Full restoration test error:", error);
    return false;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testRestoreNotes()
    .then((success) => {
      if (success) {
        console.log(
          "\n🎉 All tests passed! Notes restoration is working correctly."
        );
        process.exit(0);
      } else {
        console.log("\n💥 Some tests failed. Please check the errors above.");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("💥 Unexpected error during testing:", error);
      process.exit(1);
    });
}

module.exports = { testRestoreNotes };

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

  // Test 2: Check if we can connect to database
  console.log("🔗 Test 2: Checking database connectivity...");
  try {
    const { Redis } = require("@upstash/redis");

    const isRedisAvailable = () => {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      return !!(url && token);
    };

    if (isRedisAvailable()) {
      console.log("✅ Redis configuration found");

      const getRedisClient = () => {
        const url = process.env.UPSTASH_REDIS_REST_URL;
        const token = process.env.UPSTASH_REDIS_REST_TOKEN;

        if (!url || !token) {
          throw new Error("Redis configuration missing");
        }

        return new Redis({
          url,
          token,
        });
      };

      const redis = getRedisClient();
      await redis.ping();
      console.log("✅ Redis connection successful");
    } else {
      console.log("ℹ️ Redis not available, will use file storage");
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

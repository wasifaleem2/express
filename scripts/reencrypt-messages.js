// Re-encrypt every stored message to the CURRENT key, so you can safely retire
// an old key from the ring afterwards.
//
// You do NOT need this just to rotate — adding a new current key already keeps
// old messages readable (the keyring picks the right key per row). Run this only
// when you want to fully migrate rows off an old key before removing it.
//
// Usage (keep BOTH the old and new keys in the ring while running):
//   MESSAGE_ENC_KEYS='{"v1":"<old>","k2":"<new>"}' \
//   MESSAGE_ENC_KEY_CURRENT=k2 \
//   node scripts/reencrypt-messages.js
//
// Idempotent: rows already on the current key (and E2EE / plaintext rows) are
// skipped, so it's safe to re-run.
require("dotenv").config();
const mongoose = require("mongoose");
const {
  encryptText,
  decryptText,
  keyIdOf,
  currentKeyId,
} = require("../utilis/encryption");

(async () => {
  const url = process.env.LOCAL_DB_URL;
  if (!url) {
    console.error("LOCAL_DB_URL is not set.");
    process.exit(1);
  }
  await mongoose.connect(url);
  const Messages = mongoose.connection.collection("messages");

  const cursor = Messages.find(
    { text: { $regex: "^enc:" } },
    { projection: { text: 1 } }
  );

  let scanned = 0;
  let reencrypted = 0;
  let failed = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned++;
    const id = keyIdOf(doc.text);
    if (!id || id === currentKeyId) continue; // already on current key

    const plain = decryptText(doc.text);
    if (plain === "[unable to read message]") {
      failed++;
      console.warn(`  ! could not decrypt ${doc._id} (key "${id}" missing?)`);
      continue;
    }
    await Messages.updateOne(
      { _id: doc._id },
      { $set: { text: encryptText(plain) } }
    );
    reencrypted++;
  }

  console.log(
    `Done. scanned=${scanned} reencrypted=${reencrypted} failed=${failed} → all readable rows now use key "${currentKeyId}".`
  );
  if (failed === 0) {
    console.log("Safe to remove the old key from MESSAGE_ENC_KEYS.");
  } else {
    console.log("Keep the old key until 'failed' is 0.");
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("re-encrypt failed:", e);
  process.exit(1);
});

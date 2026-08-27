// One-time (idempotent) backfill: populate `phoneKey` (canonical E.164) for
// existing users from their stored `phone`. Additive — never changes `phone`.
//
// Usage (from express/):  node scripts/backfill-phonekey.js
// Requires DATABASE_URL (and optionally DEFAULT_PHONE_REGION) in the env.
require("dotenv").config();
const mongoose = require("mongoose");
const UserModel = require("../models/UserModel");
const { toE164, DEFAULT_REGION } = require("../utilis/phone");

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  mongoose.set("strictQuery", false);
  await mongoose.connect(url, { useNewUrlParser: true });
  console.log(`Connected. Default region: ${DEFAULT_REGION}`);

  // Only touch rows that don't already have a key, so re-runs are cheap.
  const users = await UserModel.find({
    $or: [{ phoneKey: { $exists: false } }, { phoneKey: "" }],
  }).select("phone phoneKey");

  let updated = 0;
  let skipped = 0;
  for (const u of users) {
    const key = toE164(u.phone);
    if (!key) {
      skipped++;
      console.warn(`  could not normalize: ${u.phone}`);
      continue;
    }
    await UserModel.updateOne({ _id: u._id }, { $set: { phoneKey: key } });
    updated++;
  }

  console.log(
    `Done. ${updated} updated, ${skipped} unparseable, ${users.length} scanned.`
  );
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

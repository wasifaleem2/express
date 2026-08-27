const { parsePhoneNumberFromString } = require("libphonenumber-js");

// Default region used to interpret LOCAL numbers (no country code), e.g. a
// user who typed "03001234567". Numbers already in international form (+92…,
// 0092…) are parsed on their own and this is ignored. Override per deployment.
const DEFAULT_REGION = process.env.DEFAULT_PHONE_REGION || "PK";

// Normalize any phone string to canonical E.164 (e.g. "+923001234567") so the
// same person's number matches regardless of how it was typed or formatted in
// a device address book. Returns "" when the input can't be parsed into a valid
// number — callers then fall back to the raw `phone` field, so nothing breaks.
function toE164(raw) {
  if (!raw) return "";
  try {
    const parsed = parsePhoneNumberFromString(String(raw), DEFAULT_REGION);
    return parsed && parsed.isValid() ? parsed.number : "";
  } catch {
    return "";
  }
}

// Normalize a list, dropping blanks/dupes. Handy for batch lookups.
function toE164Many(list) {
  const out = new Set();
  (Array.isArray(list) ? list : []).forEach((n) => {
    const key = toE164(n);
    if (key) out.add(key);
  });
  return Array.from(out);
}

module.exports = { toE164, toE164Many, DEFAULT_REGION };

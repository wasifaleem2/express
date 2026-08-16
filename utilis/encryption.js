// Application-layer encryption for message content AT REST, with a KEYRING so
// keys can be rotated without making old messages unreadable.
//
// Stored format:  "enc:<keyId>:" + base64( iv[12] | authTag[16] | ciphertext )
//   - New messages are encrypted with the CURRENT key and tagged with its id.
//   - On read, the id in the row selects which key decrypts it, so messages
//     encrypted under older keys keep working as long as those keys stay in the
//     ring. Legacy plaintext (no "enc:" prefix) passes through unchanged.
//
// Configuration (env):
//   Preferred (supports rotation):
//     MESSAGE_ENC_KEYS='{"v1":"<old material>","k2":"<new material>"}'
//     MESSAGE_ENC_KEY_CURRENT=k2
//   Backward-compatible fallback (single key, id "v1"):
//     MESSAGE_ENC_KEY=<material>
//
// To ROTATE: add a new entry to MESSAGE_ENC_KEYS, keep the old one, and point
// MESSAGE_ENC_KEY_CURRENT at the new id. Nothing is re-encrypted and no message
// becomes unreadable. Retire an old key only after re-encrypting rows that use
// it (see scripts/reencrypt-messages.js).
const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

// Any string works as key material — it's hashed to a stable 32-byte AES key.
// (This also keeps compatibility with existing "enc:v1:" rows, which were
// encrypted with sha256(MESSAGE_ENC_KEY).)
const deriveKey = (material) =>
  crypto.createHash("sha256").update(String(material)).digest();

function buildKeyring() {
  const ring = {};
  let current;

  if (process.env.MESSAGE_ENC_KEYS) {
    let map;
    try {
      map = JSON.parse(process.env.MESSAGE_ENC_KEYS);
    } catch (e) {
      throw new Error("MESSAGE_ENC_KEYS must be valid JSON: " + e.message);
    }
    for (const [id, material] of Object.entries(map)) {
      ring[id] = deriveKey(material);
    }
    current = process.env.MESSAGE_ENC_KEY_CURRENT || Object.keys(map)[0];
  } else {
    // Fallback: single key, id "v1" (matches the previous single-key format).
    ring["v1"] = deriveKey(process.env.MESSAGE_ENC_KEY || "dev-insecure-change-me");
    current = "v1";
  }

  if (!ring[current]) {
    throw new Error(`MESSAGE_ENC_KEY_CURRENT="${current}" is not in the keyring`);
  }
  return { ring, current };
}

const { ring, current } = buildKeyring();

function encryptText(plain) {
  if (plain === null || plain === undefined) return plain;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, ring[current], iv);
  const ct = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `enc:${current}:` + Buffer.concat([iv, tag, ct]).toString("base64");
}

function decryptText(stored) {
  if (typeof stored !== "string" || !stored.startsWith("enc:")) {
    return stored; // legacy plaintext / non-string — as-is
  }
  const sep = stored.indexOf(":", 4); // second colon (base64 has no ":")
  if (sep === -1) return stored;
  const keyId = stored.slice(4, sep);
  const payload = stored.slice(sep + 1);

  const key = ring[keyId];
  if (!key) {
    console.error(`decryptText: no key "${keyId}" in the keyring`);
    return "[unable to read message]";
  }
  try {
    const raw = Buffer.from(payload, "base64");
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8"
    );
  } catch (e) {
    console.error("decryptText failed:", e.message);
    return "[unable to read message]";
  }
}

// Which key id encrypted a stored value (null for legacy plaintext).
function keyIdOf(stored) {
  if (typeof stored !== "string" || !stored.startsWith("enc:")) return null;
  const sep = stored.indexOf(":", 4);
  return sep === -1 ? null : stored.slice(4, sep);
}

module.exports = {
  encryptText,
  decryptText,
  keyIdOf,
  currentKeyId: current,
  keyIds: Object.keys(ring),
};

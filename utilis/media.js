// Attachments (images + documents): naming, validation, read access, cleanup.
//
// Files are encrypted on the device with the message's own Message Key and
// uploaded straight to Blob Storage. A message only stores the blob NAMES (in
// `images` or `documents`); viewers ask for short-lived read URLs. No separate
// media collection: the uploader is encoded in the blob name prefix.
const crypto = require("crypto");
const MessageModel = require("../models/MessagesModel");
const GroupModel = require("../models/GroupModel");
const blobStorage = require("./blobStorage");

// Max images, or max documents, in one message.
const MAX_ATTACHMENTS = 4;
// Largest file (original size, bytes) that can be attached — the single source
// of truth: the app fetches it from GET /media/limits for its "too large" check.
const MEDIA_MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES) || 10000 * 1024;
// Encryption adds iv(12) + GCM tag(16) to every stored blob.
const ENCRYPTION_OVERHEAD = 28;

// "u/<hash of phone>/" — proves who uploaded a blob without storing the phone
// number itself in Blob Storage.
const ownerPrefix = (phone) =>
  `u/${crypto.createHash("sha256").update(String(phone)).digest("hex").slice(0, 16)}/`;

const newBlobName = (phone) => `${ownerPrefix(phone)}${crypto.randomUUID()}`;

// Request value -> array of blob names. null / "" / missing => [].
// Returns null if the value is malformed.
const normalizeNames = (raw) => {
  if (raw == null || raw === "") return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null;
  if (raw.some((n) => typeof n !== "string" || !n)) return null;
  return [...new Set(raw)];
};

// Every attached file must be the sender's own upload, actually present in
// Blob Storage and within the size cap (a SAS URL can't enforce size).
// Returns null when valid, else { status, message }.
const validateUploadsForSend = async (names, phone) => {
  if (!names.length) return null;
  if (!blobStorage.isEnabled()) {
    return { status: 503, message: "Media storage is not configured." };
  }
  const prefix = ownerPrefix(phone);
  for (const name of names) {
    if (!name.startsWith(prefix)) {
      return { status: 400, message: "Invalid attachment." };
    }
    const size = await blobStorage.getBlobSize(name);
    if (size === null) {
      return { status: 400, message: "Attachment was not uploaded." };
    }
    if (size > MEDIA_MAX_BYTES + ENCRYPTION_OVERHEAD) {
      await blobStorage.deleteBlob(name).catch(() => {});
      return { status: 413, message: "Attachment is too large." };
    }
  }
  return null;
};

// Of `names`, the ones `phone` may read: their own uploads, or files on a live
// message they sent/received or that went to a group they're in.
const readableMedia = async (names, phone) => {
  const prefix = ownerPrefix(phone);
  const readable = new Set(names.filter((n) => n.startsWith(prefix)));
  const others = names.filter((n) => !readable.has(n));
  if (!others.length) return [...readable];

  const messages = await MessageModel.find({
    $or: [{ images: { $in: others } }, { documents: { $in: others } }],
    deletedForAll: { $ne: true },
  }).select("senderNumber receiverNumber groupId images documents");

  const groupIds = [...new Set(messages.filter((m) => m.groupId).map((m) => m.groupId))];
  const myGroups = groupIds.length
    ? new Set(
        (await GroupModel.find({ groupId: { $in: groupIds }, members: phone }).select("groupId"))
          .map((g) => g.groupId)
      )
    : new Set();

  for (const m of messages) {
    const allowed = m.groupId
      ? myGroups.has(m.groupId)
      : m.senderNumber === phone || m.receiverNumber === phone;
    if (allowed) {
      [...(m.images || []), ...(m.documents || [])].forEach(
        (n) => others.includes(n) && readable.add(n)
      );
    }
  }
  return [...readable];
};

// Best-effort blob delete (delete for everyone / delete chat). Never throws.
const deleteBlobs = async (names) => {
  if (!names?.length || !blobStorage.isEnabled()) return;
  await Promise.all(
    names.map((name) =>
      blobStorage
        .deleteBlob(name)
        .catch((error) => console.error(`[media] delete ${name} failed:`, error.message))
    )
  );
};

module.exports = {
  MAX_ATTACHMENTS,
  MEDIA_MAX_BYTES,
  newBlobName,
  normalizeNames,
  validateUploadsForSend,
  readableMedia,
  deleteBlobs,
};

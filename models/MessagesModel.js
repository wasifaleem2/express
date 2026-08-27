const mongoose = require("mongoose");

// End-to-end encrypted message. The server stores only ciphertext + the
// per-recipient wrapped Message Keys and can never read the content.
const MessageSchema = new mongoose.Schema(
  {
    senderNumber: { type: String, required: true },
    // Client-generated id for this send (stable across offline retries). Lets the
    // server dedupe when a 200 was lost and the client retries the same message.
    // Uniqueness is enforced by the partial compound index below (not here).
    clientId: { type: String, default: null },
    // 1:1 recipient phone. Null for group messages (routing is by groupId).
    receiverNumber: { type: String, default: null },
    // Set for group messages; null for 1:1. Fan-out targets the group's members.
    groupId: { type: String, default: null, index: true },

    // ---- E2EE payload ----
    // AES-256-GCM ciphertext of the message body (base64). "" for a tombstone.
    text: { type: String, default: "" },
    // AES-GCM IV/nonce (base64).
    nonce: { type: String, default: "" },
    // The one-time Message Key, wrapped separately for each participant using
    // that participant's public key (sealed box), keyed by phone number:
    //   { "+92...recipient": "<base64>", "+92...sender": "<base64>" }
    // The sender's own copy is included so they can restore their messages later.
    encryptedMessageKeys: { type: Object, default: {} },

    // Server-stamped canonical time (UTC ISO 8601).
    dateTime: { type: String, required: true },
    messageType: { type: String, required: true, default: "text" },
    // _id of the message this one replies to (null for normal messages).
    replyTo: { type: String, default: null },
    // True when forwarded from another chat (shown as a "Forwarded" label).
    forwarded: { type: Boolean, default: false },
    // Phone numbers @mentioned in a group message.
    mentions: { type: [String], default: [] },

    // Delivery / read tracking (group-ready: arrays of member phone numbers).
    status: { type: String, default: "send" },
    deliveredTo: { type: [String], default: [] },
    readBy: { type: [String], default: [] },

    // Edit + soft-delete metadata.
    editedAt: { type: Date, default: null },
    deletedForAll: { type: Boolean, default: false },
    deletedForAllAt: { type: Date, default: null },
    deletedFor: { type: [String], default: [] },
  },
  { timestamps: true }
);

// DB-level dedupe guarantee: at most one message per (senderNumber, clientId).
// The controller's findOne check is racy on its own (two concurrent retries can
// both pass it and insert); this partial unique index makes the second insert
// fail with E11000 so the controller can return the already-saved copy instead
// of creating a duplicate. Partial so the many rows with clientId=null (older
// messages / non-client-id sends) are exempt from the uniqueness constraint.
MessageSchema.index(
  { senderNumber: 1, clientId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientId: { $type: "string" } },
  }
);

const MessageModel = mongoose.model("messages", MessageSchema);
module.exports = MessageModel;

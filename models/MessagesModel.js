const mongoose = require("mongoose");
const MessageSchema = new mongoose.Schema({
  senderNumber: {
    type: String,
    required: true,
  },
  receiverNumber: {
    type: String,
    required: true,
  },
  // Plaintext body for legacy (pre-E2EE) messages. Encrypted messages leave
  // this empty and populate the cipher fields below, so it is no longer
  // required.
  text: {
    type: String,
    default: "",
  },
  // ---- End-to-end encryption (encVersion >= 1) ----
  // The server stores only ciphertext and per-recipient wrapped keys; it can
  // never read the message. `envelopes` generalises to group chats (one entry
  // per member).
  encVersion: {
    type: Number,
    default: 0,
  },
  ciphertext: {
    type: String,
    default: "",
  },
  nonce: {
    type: String,
    default: "",
  },
  senderPub: {
    type: String,
    default: "",
  },
  envelopes: {
    type: [
      {
        _id: false,
        phone: String,
        key: String,
        keyNonce: String,
      },
    ],
    default: [],
  },
  dateTime: {
    type: String,
    required: true,
  },
  // time: {
  //   type: String,
  //   required: true,
  // },
  messageType: {
    type: String,
    required: true,
    default: "text"
  },
  // _id of the message this one is replying to (null for normal messages). The
  // quoted preview is resolved client-side from the already-decrypted messages,
  // so no plaintext of the quoted message is stored here (keeps E2EE intact).
  replyTo: {
    type: String,
    default: null,
  },
  // Legacy single-state field, kept for backward compatibility. The real
  // per-recipient tracking lives in deliveredTo / readBy below, which the
  // client derives a display status from. This generalises to group chats:
  // in a group a message can be delivered to / read by many members.
  status: {
    type: String,
    default: "send"
  },
  // Phone numbers of recipients whose device has received the message.
  deliveredTo: {
    type: [String],
    default: [],
  },
  // Phone numbers of recipients who have opened/read the message.
  readBy: {
    type: [String],
    default: [],
  },
  // Set when a message is edited; the client shows "edited <date>".
  editedAt: {
    type: Date,
    default: null,
  },
  // Soft delete — "delete for everyone" (sender only). The row is kept as a
  // tombstone; text is cleared and both parties see "This message was deleted".
  deletedForAll: {
    type: Boolean,
    default: false,
  },
  deletedForAllAt: {
    type: Date,
    default: null,
  },
  // Soft delete — "delete for me". Holds the phone numbers of users who
  // personally deleted this message; it stays visible to everyone else.
  deletedFor: {
    type: [String],
    default: [],
  },
}, { timestamps: true });
const MessageModel = mongoose.model("messages", MessageSchema);
module.exports = MessageModel;
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
  text: {
    type: String,
    required: true,
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
  status: {
    type: String,
    default: "send"
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
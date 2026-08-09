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
}, { timestamps: true });
const MessageModel = mongoose.model("messages", MessageSchema);
module.exports = MessageModel;
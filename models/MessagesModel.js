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
  date: {
    type: String,
    required: true,
  },
  time: {
    type: String,
    required: true,
  },
  messageType: {
    type: String,
    required: true,
  },
});
const MessageModel = mongoose.model("messages", MessageSchema);
module.exports = MessageModel;
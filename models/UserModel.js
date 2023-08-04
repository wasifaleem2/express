const mongoose = require("mongoose");
const UserSchema = new mongoose.Schema({
  phone: {
    type: String,
    unique: true,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
  time: {
    type: String,
    required: true,
  },
  socketId: {
    type: String,
    required: true,
  },
});
const UserModel = mongoose.model("users", UserSchema);
module.exports = UserModel;
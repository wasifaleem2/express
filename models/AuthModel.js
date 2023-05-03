const mongoose = require("mongoose");
const UserModel = require("./UserModel");

const AuthSchema = new mongoose.Schema({
  phone: {
    type: String,
    unique: true,
    required: true,
  },
  token: {
    type: String,
    required: true,
  },
//   userId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'users'
//   },
});
const AuthModel = mongoose.model("token", AuthSchema);
module.exports = AuthModel;
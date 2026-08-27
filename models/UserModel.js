const mongoose = require("mongoose");
const UserSchema = new mongoose.Schema({
  phone: {
    type: String,
    unique: true,
    required: true,
  },
  // Canonical E.164 form of `phone` (e.g. "+923001234567"), derived on write.
  // Additive/optional: `phone` is unchanged and stays the source of truth; this
  // is only a match key so a number resolves regardless of formatting. Empty
  // when the number couldn't be normalized — lookups fall back to `phone`.
  phoneKey: {
    type: String,
    default: "",
    index: true,
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
    required: false,
  },
  socketId: {
    type: String,
    required: false,
  },
  // Base64 Curve25519 public key for end-to-end encryption. Published by the
  // user's device; safe to store server-side (public keys are not secret).
  publicKey: {
    type: String,
    default: "",
  },
});
const UserModel = mongoose.model("users", UserSchema);
module.exports = UserModel;
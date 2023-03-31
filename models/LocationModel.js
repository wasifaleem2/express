const mongoose = require("mongoose");
const UserModel = require("./UserModel");

const LocationSchema = new mongoose.Schema({
  phone: {
    type: String,
    unique: true,
    required: true,
  },
  city: {
    type: String,
    required: true,
  },
  province: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users'
  },
});
const LocationModel = mongoose.model("locations", LocationSchema);
module.exports = LocationModel;
const mongoose = require("mongoose");

// A group conversation. E2EE is unchanged from 1:1 chats: each message's
// Message Key is wrapped for every member into the message's encryptedMessageKeys
// map, so the server stores group metadata (name, members) but can never read
// any message. Membership is fixed at creation for v1.
const GroupSchema = new mongoose.Schema(
  {
    // Stable, server-generated id (e.g. "grp_<ObjectId>"). Used as the routing
    // key on messages/sockets and in local-storage keys on the client.
    groupId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    // Member / admin phone numbers (creator is always a member + admin).
    members: { type: [String], default: [] },
    admins: { type: [String], default: [] },
    createdBy: { type: String, required: true },
    avatar: { type: String, default: "" },
  },
  { timestamps: true }
);

const GroupModel = mongoose.model("groups", GroupSchema);
module.exports = GroupModel;

const mongoose = require("mongoose");
const GroupModel = require("../../models/GroupModel");
const UserModel = require("../../models/UserModel");
const MessageDto = require("../../dtos/messageDto");
const { connectedSockets } = require("../../utilis/Socket");

// Notify every current member (plus any extra phones, e.g. a just-removed
// member so their client can drop the group) that the roster/metadata changed.
function broadcastGroupUpdate(group, extraPhones = []) {
  const audience = [...new Set([...(group.members || []), ...extraPhones])];
  audience.forEach((phone) => {
    const socket = connectedSockets[phone];
    if (socket) socket.emit("group-updated", { group });
  });
}

// Load a group by :groupId and assert the caller is an ADMIN. On failure it
// sends the right error response and returns null.
async function loadAsAdmin(req, res) {
  const me = req.user.phone;
  const group = await GroupModel.findOne({ groupId: req.params.groupId });
  if (!group) {
    res.status(404).json(new MessageDto(404, "Group not found."));
    return null;
  }
  if (!group.admins.includes(me)) {
    res.status(403).json(new MessageDto(403, "Only admins can manage members."));
    return null;
  }
  return group;
}

// Create a group. Membership is fixed at creation for v1: the creator plus the
// chosen members. Identity comes from the JWT (req.user.phone), never the body.
const createGroup = async (req, res) => {
  try {
    const me = req.user.phone;
    const name = (req.body.name || "").trim();
    const requested = Array.isArray(req.body.members) ? req.body.members : [];

    if (!name) {
      return res.status(400).json(new MessageDto(400, "Group name is required."));
    }

    // De-dupe and always include the creator.
    const members = [...new Set([me, ...requested.map((m) => String(m))])];
    if (members.length < 2) {
      return res
        .status(400)
        .json(new MessageDto(400, "A group needs at least one other member."));
    }

    const groupId = `grp_${new mongoose.Types.ObjectId().toString()}`;
    const group = await GroupModel.create({
      groupId,
      name,
      members,
      admins: [me],
      createdBy: me,
    });

    return res
      .status(200)
      .json(new MessageDto(200, "Group created.", { group }));
  } catch (error) {
    console.error("createGroup failed:", error);
    return res.status(500).json(new MessageDto(500, "Server Error.", error));
  }
};

// List the groups the caller belongs to (analogue of getMessagedUsers).
const getMyGroups = async (req, res) => {
  try {
    const me = req.user.phone;
    const groups = await GroupModel.find({ members: me }).sort({ updatedAt: -1 });
    return res
      .status(200)
      .json(new MessageDto(200, `Groups for user ${me}.`, { groupList: groups }));
  } catch (error) {
    console.error("getMyGroups failed:", error);
    return res.status(500).json(new MessageDto(500, "Server Error.", error));
  }
};

// Fetch a single group. Only members may read it.
const getGroup = async (req, res) => {
  try {
    const me = req.user.phone;
    const group = await GroupModel.findOne({ groupId: req.params.groupId });
    if (!group) {
      return res.status(404).json(new MessageDto(404, "Group not found."));
    }
    if (!group.members.includes(me)) {
      return res.status(403).json(new MessageDto(403, "Not a member of this group."));
    }
    return res.status(200).json(new MessageDto(200, "Group.", { group }));
  } catch (error) {
    console.error("getGroup failed:", error);
    return res.status(500).json(new MessageDto(500, "Server Error.", error));
  }
};

// ---- Membership & admin management (admin-gated) ----
//
// E2EE note: the server never touches keys. Adding a member means the CLIENTS
// start sealing future messages' Message Key to that member too (they read the
// updated roster). Past messages are NOT re-keyed, so a new member can't read
// history and a removed member keeps only what they already received — expected
// for this scheme (no forward secrecy / key rotation in v1).

// POST /group/:groupId/members   body { members: [phone] }
const addMembers = async (req, res) => {
  try {
    const group = await loadAsAdmin(req, res);
    if (!group) return;
    const toAdd = (Array.isArray(req.body.members) ? req.body.members : [])
      .map((m) => String(m))
      .filter((m) => m && !group.members.includes(m));
    if (toAdd.length === 0) {
      return res.status(400).json(new MessageDto(400, "No new members to add."));
    }
    const updated = await GroupModel.findOneAndUpdate(
      { groupId: group.groupId },
      { $addToSet: { members: { $each: toAdd } } },
      { new: true }
    );
    broadcastGroupUpdate(updated);
    return res
      .status(200)
      .json(new MessageDto(200, "Members added.", { group: updated }));
  } catch (error) {
    console.error("addMembers failed:", error);
    return res.status(500).json(new MessageDto(500, "Server Error.", error));
  }
};

// DELETE /group/:groupId/members/:member   (owner is protected)
const removeMember = async (req, res) => {
  try {
    const group = await loadAsAdmin(req, res);
    if (!group) return;
    const member = String(req.params.member);
    if (member === group.createdBy) {
      return res
        .status(400)
        .json(new MessageDto(400, "The group owner can't be removed."));
    }
    if (!group.members.includes(member)) {
      return res.status(404).json(new MessageDto(404, "Not a member."));
    }
    const updated = await GroupModel.findOneAndUpdate(
      { groupId: group.groupId },
      { $pull: { members: member, admins: member } },
      { new: true }
    );
    broadcastGroupUpdate(updated, [member]); // notify the removed member too
    return res
      .status(200)
      .json(new MessageDto(200, "Member removed.", { group: updated }));
  } catch (error) {
    console.error("removeMember failed:", error);
    return res.status(500).json(new MessageDto(500, "Server Error.", error));
  }
};

// POST /group/:groupId/admins/:member   — promote a member to admin
const promoteAdmin = async (req, res) => {
  try {
    const group = await loadAsAdmin(req, res);
    if (!group) return;
    const member = String(req.params.member);
    if (!group.members.includes(member)) {
      return res.status(400).json(new MessageDto(400, "That user isn't a member."));
    }
    const updated = await GroupModel.findOneAndUpdate(
      { groupId: group.groupId },
      { $addToSet: { admins: member } },
      { new: true }
    );
    broadcastGroupUpdate(updated);
    return res
      .status(200)
      .json(new MessageDto(200, "Now an admin.", { group: updated }));
  } catch (error) {
    console.error("promoteAdmin failed:", error);
    return res.status(500).json(new MessageDto(500, "Server Error.", error));
  }
};

// DELETE /group/:groupId/admins/:member   (owner stays admin)
const demoteAdmin = async (req, res) => {
  try {
    const group = await loadAsAdmin(req, res);
    if (!group) return;
    const member = String(req.params.member);
    if (member === group.createdBy) {
      return res
        .status(400)
        .json(new MessageDto(400, "The group owner stays an admin."));
    }
    const updated = await GroupModel.findOneAndUpdate(
      { groupId: group.groupId },
      { $pull: { admins: member } },
      { new: true }
    );
    broadcastGroupUpdate(updated);
    return res
      .status(200)
      .json(new MessageDto(200, "Admin removed.", { group: updated }));
  } catch (error) {
    console.error("demoteAdmin failed:", error);
    return res.status(500).json(new MessageDto(500, "Server Error.", error));
  }
};

// POST /group/:groupId/leave   — any member can leave.
const leaveGroup = async (req, res) => {
  try {
    const me = req.user.phone;
    const group = await GroupModel.findOne({ groupId: req.params.groupId });
    if (!group) {
      return res.status(404).json(new MessageDto(404, "Group not found."));
    }
    if (!group.members.includes(me)) {
      return res.status(400).json(new MessageDto(400, "You're not in this group."));
    }
    const members = group.members.filter((m) => m !== me);
    let admins = group.admins.filter((a) => a !== me);
    // Never leave a non-empty group with no admin — promote the first member.
    if (admins.length === 0 && members.length > 0) {
      admins = [members[0]];
    }
    const updated = await GroupModel.findOneAndUpdate(
      { groupId: group.groupId },
      { $set: { members, admins } },
      { new: true }
    );
    broadcastGroupUpdate(updated, [me]); // notify the leaver's own other devices
    return res
      .status(200)
      .json(new MessageDto(200, "Left the group.", { group: updated }));
  } catch (error) {
    console.error("leaveGroup failed:", error);
    return res.status(500).json(new MessageDto(500, "Server Error.", error));
  }
};

module.exports = {
  createGroup,
  getMyGroups,
  getGroup,
  addMembers,
  removeMember,
  promoteAdmin,
  demoteAdmin,
  leaveGroup,
};

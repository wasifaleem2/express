const mongoose = require("mongoose");
const GroupModel = require("../../models/GroupModel");
const UserModel = require("../../models/UserModel");
const MessageDto = require("../../dtos/messageDto");

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

module.exports = { createGroup, getMyGroups, getGroup };

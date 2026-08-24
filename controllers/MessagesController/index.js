const mongoose = require("mongoose");
const UserModel = require("../../models/UserModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const MessageModel = require("../../models/MessagesModel");
const GroupModel = require("../../models/GroupModel");
const { StatusCodes } = require("http-status-codes");
const { connectedSockets } = require("../../utilis/Socket");
const MessageDto = require("../../dtos/messageDto");
const { getUserTokens } = require("../../utilis/appTokens");
const sendNotification = require("../../utilis/sendNotification");

// Emit a socket event to each given phone number that has a live socket.
// Used to push edits/deletes to both parties (or every group member) in real time.
const emitToUsers = (phones, event, payload) => {
  phones.forEach((phone) => {
    const socket = connectedSockets[phone];
    if (socket) {
      socket.emit(event, payload);
    }
  });
};

// Resolve who should receive real-time edit/delete events for a message: the
// full group roster for a group message, or the two parties for a 1:1.
const messageAudience = async (message) => {
  if (message.groupId) {
    const group = await GroupModel.findOne({ groupId: message.groupId }).select("members");
    return group ? group.members : [message.senderNumber];
  }
  return [message.senderNumber, message.receiverNumber];
};

// WhatsApp-style DATA-ONLY FCM push. The server never sees plaintext: it sends
// the ciphertext + the *recipient's own* wrapped Message Key, and the device
// decrypts with its private key and renders the real text via notifee. A
// data-only message (no `notification` block) wakes the app's background handler
// even when killed. For group messages we also pass groupId/groupName so the
// device can title the notification with the group. Best-effort, never throws.
const sendChatPush = async ({
  tokens,
  senderNumber,
  senderName,
  messageId,
  text,
  nonce,
  encKey,
  groupId,
  groupName,
}) => {
  const data = {
    type: "chat",
    messageId: String(messageId),
    senderNumber: String(senderNumber),
    senderName: String(senderName),
    text: String(text), // AES-GCM ciphertext (base64)
    nonce: String(nonce), // AES-GCM IV (base64)
    encKey: String(encKey || ""), // this recipient's sealed Message Key
  };
  if (groupId) {
    data.groupId = String(groupId);
    data.groupName = String(groupName || "");
  }
  const results = await Promise.allSettled(
    tokens.map((t) =>
      sendNotification({
        data,
        // priority "high" so FCM wakes the device / a killed app promptly
        // (normal priority is delayed or dropped in Doze).
        android: { priority: "high" },
        token: t,
      })
    )
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      console.log(`[push] sent OK to token #${i}`);
    } else {
      console.error(`[push] FCM send FAILED for token #${i}:`, r.reason?.message || r.reason);
    }
  });
};

const getNoOfMessage = async (req, res) => {
  // Identity comes from the JWT, never a client-supplied query param (IDOR).
  const phone = req.user.phone;
  await MessageModel.countDocuments({
    $or: [{ senderNumber: phone }, { receiverNumber: phone }],
  })
    .then((count) => {
      console.log(`Number of documents in the collection: ${count}`);
      res.status(200).json(new MessageDto(200, `Number of messages for user phone:  ${phone}`, {counts: count.toString()}));
    })
    .catch((error) => {
      res.status(500).json(new MessageDto(500, `Server Error`, error));

    });
};

const getMessage = async (req, res) => {
  const senderNumber = req.query.senderNumber;
  const receiverNumber = req.query.receiverNumber;
  const groupId = req.query.groupId;
  const me = req.user?.phone;

  // ---- Group thread ----
  if (groupId) {
    try {
      const group = await GroupModel.findOne({ groupId });
      if (!group) {
        return res.status(404).json(new MessageDto(404, "Group not found."));
      }
      if (!group.members.includes(me)) {
        return res.status(403).json(new MessageDto(403, "Not a member of this group."));
      }
      const msgs = await MessageModel.find({
        $and: [{ groupId }, { deletedFor: { $ne: me } }],
      }).exec();
      return res
        .status(200)
        .json(new MessageDto(200, `Messages for group ${groupId}`, { messages: msgs }));
    } catch (err) {
      console.log(err);
      return res.status(500).json(new MessageDto(500, `Server Error`, err));
    }
  }

  // Authorization: the caller must be one of the two participants. Prevents
  // reading someone else's thread by passing arbitrary numbers (IDOR).
  if (me !== senderNumber && me !== receiverNumber) {
    return res.status(403).json(new MessageDto(403, "Not your conversation."));
  }

  MessageModel.find({
    $and: [
      {
        $or: [
          { senderNumber: senderNumber, receiverNumber: receiverNumber },
          { senderNumber: receiverNumber, receiverNumber: senderNumber },
        ],
      },
      // Hide messages this user personally deleted ("delete for me").
      // "delete for everyone" rows are kept and returned as tombstones.
      { deletedFor: { $ne: me } },
    ],
  })
    .exec()
    .then((msgs) => {
      // E2EE: return ciphertext + wrapped keys verbatim; only the participants'
      // devices can decrypt.
      res.status(200).json(new MessageDto(200, `Messages for user with phone ${senderNumber}`, {messages: msgs}));
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json(new MessageDto(500, `Server Error`, err));
    });
};

const getAllMessages = (req, res) => {
  // Identity from the JWT, not a query param (IDOR).
  const phone = req.user.phone;
  MessageModel.find({
    $and: [
      { $or: [{ senderNumber: phone }, { receiverNumber: phone }] },
      { deletedFor: { $ne: phone } },
    ],
  })
    .exec()
    .then((msgs) => {
      res.status(200).json(new MessageDto(200, `All messages for user with phone ${phone} with all other users.`, {messages: msgs}));
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json(new MessageDto(500, `Server Error.`, err));
    });
};

const getMessagedUsers = async (req, res) => {
  try {
    const phone = req.user.phone;
    const messages = await MessageModel.find({
      $or: [{ senderNumber: phone }, { receiverNumber: phone }],
    });

    const uniqueContacts = [
      ...new Set(
        messages.map((m) =>
          m.senderNumber === phone ? m.receiverNumber : m.senderNumber
        )
      ),
    ];

    const messageCount = uniqueContacts.map((contact) => {
      const count = messages.filter(
        (m) =>
          m.senderNumber === contact &&
          m.receiverNumber === phone &&
          m.status === "send"
      ).length;
      return { phone: contact, count };
    });

    const users = await UserModel.find({
      phone: { $in: uniqueContacts },
    }).select("name phone socketId");

    // Most-recent message per contact, so the list can show a delivered/read
    // tick for MY last message. Metadata only — text stays E2EE (not returned).
    const lastByContact = {};
    messages.forEach((m) => {
      const contact = m.senderNumber === phone ? m.receiverNumber : m.senderNumber;
      const t = m.createdAt || m.dateTime;
      const prev = lastByContact[contact];
      if (!prev || new Date(t) >= new Date(prev._t)) {
        lastByContact[contact] = {
          _t: t,
          senderNumber: m.senderNumber,
          dateTime: m.dateTime,
          messageType: m.messageType,
          deliveredTo: m.deliveredTo || [],
          readBy: m.readBy || [],
          deletedForAll: m.deletedForAll || false,
        };
      }
    });

    const usersWithMessageCount = users.map((user) => {
      const lm = lastByContact[user.phone];
      return {
        ...user.toObject(),
        count: messageCount.find((m) => m.phone === user.phone)?.count || 0,
        lastMessage: lm
          ? {
              senderNumber: lm.senderNumber,
              dateTime: lm.dateTime,
              messageType: lm.messageType,
              deliveredTo: lm.deliveredTo,
              readBy: lm.readBy,
              deletedForAll: lm.deletedForAll,
            }
          : null,
      };
    });

    // res.status(200).send(usersWithMessageCount);
    res.status(200).json(new MessageDto(200, `Recipients List for user ${phone}.`, {recipientsList: usersWithMessageCount}));
  } catch (err) {
    console.log(err);
    // res.status(500).send(err);
    res.status(500).json(new MessageDto(500, `Server Error.`, err));
  }
};

const sendMessage = async (req, res) => {
  const senderNumber = req.body.senderNumber;
  // groupId set => group message (fan out to members); else 1:1 to receiverNumber.
  const groupId = req.body.groupId || null;
  const receiverNumber = groupId ? null : req.body.receiverNumber;
  const messageType = req.body.messageType;
  // The SERVER stamps the canonical timestamp in UTC (ISO 8601). We never trust
  // the client clock — this keeps ordering and times correct across devices in
  // different timezones. Clients convert this UTC value to local time only for
  // display (toLocaleTimeString).
  const dateTime = new Date().toISOString();
  // E2EE payload, produced entirely on the sender's device. The server stores
  // these opaquely and can never read the plaintext:
  //   text = AES-256-GCM ciphertext (base64), nonce = IV (base64),
  //   encryptedMessageKeys = { phone: wrapped Message Key } (one per member,
  //   incl. the sender's self-copy).
  const text = req.body.text || "";
  const nonce = req.body.nonce || "";
  const encryptedMessageKeys =
    req.body.encryptedMessageKeys && typeof req.body.encryptedMessageKeys === "object"
      ? req.body.encryptedMessageKeys
      : {};
  const replyTo = req.body.replyTo || null;
  // Stable per-send id from the client (offline outbox). If we already persisted
  // this exact send (a retry after a lost 200), return it instead of inserting a
  // duplicate. Fan-out already happened on the first successful save.
  const clientId = req.body.clientId || null;

  if (clientId) {
    const existing = await MessageModel.findOne({ senderNumber, clientId });
    if (existing) {
      return res.status(200).json(
        new MessageDto(200, "Already delivered (deduped by clientId).", {
          _id: String(existing._id),
          senderNumber: existing.senderNumber,
          receiverNumber: existing.receiverNumber,
          groupId: existing.groupId,
          text: existing.text,
          nonce: existing.nonce,
          encryptedMessageKeys: existing.encryptedMessageKeys,
          dateTime: existing.dateTime,
          messageType: existing.messageType,
          replyTo: existing.replyTo,
          clientId: existing.clientId,
          deliveredTo: existing.deliveredTo || [],
          readBy: existing.readBy || [],
        })
      );
    }
  }

  // For group sends, validate the sender is a member and resolve the roster.
  let group = null;
  if (groupId) {
    group = await GroupModel.findOne({ groupId });
    if (!group) {
      return res.status(404).json(new MessageDto(404, "Group not found."));
    }
    if (!group.members.includes(senderNumber)) {
      return res.status(403).json(new MessageDto(403, "Not a member of this group."));
    }
  }

  console.log(
    "message received (e2ee):",
    dateTime,
    groupId ? `group ${groupId}` : `to ${receiverNumber}`,
    "recipients:",
    Object.keys(encryptedMessageKeys)
  );

  const msg = new MessageModel({
    senderNumber,
    clientId,
    receiverNumber,
    groupId,
    text, // ciphertext, stored verbatim
    nonce,
    encryptedMessageKeys,
    dateTime,
    messageType,
    replyTo,
  });

  try {
    await msg.save();
  } catch (error) {
    console.error("Error saving message:", error);
    return res
      .status(500)
      .send({ error: error, message: "Error sending message.." });
  }

  const payload = {
    _id: String(msg._id),
    senderNumber,
    clientId,
    receiverNumber,
    groupId,
    text, // ciphertext
    nonce,
    encryptedMessageKeys,
    dateTime,
    messageType,
    replyTo,
    deliveredTo: [],
    readBy: [],
  };

  // The message is already persisted. Live delivery + push are best-effort —
  // a delivery failure must never turn a successful save into a 500.
  try {
    const sender = await UserModel.findOne({ phone: senderNumber }).select("name");
    const senderName = sender?.name || senderNumber;

    if (groupId) {
      // Fan out to every member except the sender. Each member gets the same
      // payload and decrypts with their own wrapped key; offline members get a
      // data-only push carrying only their own wrapped key.
      const others = group.members.filter((m) => m !== senderNumber);
      for (const member of others) {
        const memberSocket = connectedSockets[member];
        if (memberSocket) {
          memberSocket.emit("receive-message", payload);
          continue;
        }
        try {
          const user = await UserModel.findOne({ phone: member });
          if (!user) {
            console.log(`[push] group member ${member} not found — skipped`);
            continue;
          }
          const tokens = await getUserTokens(user._id);
          console.log(`[push] group ${groupId} member ${member} offline, ${tokens.length} token(s)`);
          if (!tokens.length) continue;
          await sendChatPush({
            tokens,
            senderNumber,
            senderName,
            messageId: msg._id,
            text,
            nonce,
            encKey: encryptedMessageKeys[member],
            groupId,
            groupName: group.name,
          });
        } catch (pushError) {
          console.error(`[push] group member ${member} push failed:`, pushError.message);
        }
      }
    } else {
      // ---- 1:1 delivery (unchanged behavior) ----
      const senderSocket = connectedSockets[senderNumber];
      const recipient = await UserModel.findOne({ phone: receiverNumber });
      const recipientOnline = !!connectedSockets[receiverNumber];

      if (senderSocket) {
        senderSocket.emit("receive-message", payload);
        if (recipient && recipient.socketId) {
          senderSocket.to(recipient.socketId).emit("receive-message", payload);
        }
      } else if (recipient && recipient.socketId) {
        // no sender socket to relay through — deliver via the server
        global.io.to(recipient.socketId).emit("receive-message", payload);
      } else {
        console.log(`No live socket for ${senderNumber} -> ${receiverNumber}`);
      }

      // If the recipient has no live socket, notify them via FCM push so
      // offline users still get the message.
      if (!recipient) {
        console.log(`[push] recipient ${receiverNumber} not found — no push`);
      } else if (recipientOnline) {
        console.log(`[push] ${receiverNumber} is ONLINE (live socket) — push skipped by design`);
      } else {
        try {
          const tokens = await getUserTokens(recipient._id);
          console.log(`[push] ${receiverNumber} offline, ${tokens.length} registered token(s)`);
          if (tokens.length === 0) {
            console.log(`[push] no FCM tokens for ${receiverNumber} — their device never registered one (or it was moved to another account on the same device)`);
          }
          await sendChatPush({
            tokens,
            senderNumber,
            senderName,
            messageId: msg._id,
            text,
            nonce,
            encKey: encryptedMessageKeys[receiverNumber],
          });
        } catch (pushError) {
          console.error("[push] lookup failed:", pushError.message);
        }
      }
    }
  } catch (socketError) {
    console.error("Live delivery failed, message still saved:", socketError);
  }

  return res
    .status(200)
    .json(
      new MessageDto(
        200,
        groupId ? `Message sent to group ${groupId}` : `Message send to ${receiverNumber}`,
        payload
      )
    );
};

const updateMessage = async (req, res) => {
  let _id = req.params.id;
  try {
    // An edit re-encrypts on the device with a fresh Message Key, so it swaps
    // in new cipher fields (ciphertext + nonce + wrapped keys).
    const update = {
      text: req.body.text || "",
      nonce: req.body.nonce || "",
      encryptedMessageKeys:
        req.body.encryptedMessageKeys &&
        typeof req.body.encryptedMessageKeys === "object"
          ? req.body.encryptedMessageKeys
          : {},
      editedAt: new Date(),
    };

    const updated = await MessageModel.findOneAndUpdate(
      { _id: _id },
      update,
      { new: true }
    );
    if (!updated) {
      return res.status(404).json(new MessageDto(404, `Message not found.`));
    }

    // Real-time: relay the re-encrypted fields to every participant so their
    // open chat updates immediately; each decrypts the new text locally.
    const audience = await messageAudience(updated);
    emitToUsers(audience, "message-edited", {
      _id: String(updated._id),
      text: updated.text, // ciphertext
      nonce: updated.nonce,
      encryptedMessageKeys: updated.encryptedMessageKeys,
      editedAt: updated.editedAt,
      senderNumber: updated.senderNumber,
      receiverNumber: updated.receiverNumber,
      groupId: updated.groupId,
    });

    res.status(200).json(new MessageDto(200, `Message updated.`, { message: updated }));
  } catch (error) {
    res.status(500).json(new MessageDto(500, `Server Error.`, error));
  }
};

// Soft delete with scope:
//   - scope "all": sender-only; marks deletedForAll and clears text so both
//     parties render a "This message was deleted" tombstone.
//   - scope "me" (default): adds the requester's phone to deletedFor, hiding
//     the message only for them.
const deleteMessage = async (req, res) => {
  const _id = req.params.id;
  const scope = req.body?.scope || req.query?.scope || "me";
  const phone = req.user?.phone;

  try {
    const message = await MessageModel.findById(_id);
    if (!message) {
      return res.status(404).json(new MessageDto(404, `Message not found.`));
    }

    if (scope === "all") {
      if (message.senderNumber !== phone) {
        return res
          .status(403)
          .json(new MessageDto(403, `Only the sender can delete for everyone.`));
      }
      // findByIdAndUpdate (not save) so clearing the required `text` field to
      // "" doesn't trip schema validation. The tombstone is all that remains.
      const updated = await MessageModel.findByIdAndUpdate(
        _id,
        {
          deletedForAll: true,
          deletedForAllAt: new Date(),
          text: "",
          nonce: "",
          encryptedMessageKeys: {},
        },
        { new: true }
      );

      // Real-time: turn the message into a tombstone on every participant's
      // device at once.
      const audience = await messageAudience(updated);
      emitToUsers(audience, "message-deleted", {
        _id: String(updated._id),
        deletedForAll: true,
        senderNumber: updated.senderNumber,
        receiverNumber: updated.receiverNumber,
        groupId: updated.groupId,
      });

      return res
        .status(200)
        .json(new MessageDto(200, `Message deleted for everyone.`, { message: updated }));
    }

    // personal "delete for me"
    await MessageModel.updateOne(
      { _id },
      { $addToSet: { deletedFor: phone } }
    );
    return res
      .status(200)
      .json(new MessageDto(200, `Message deleted for you.`, { id: _id, scope: "me" }));
  } catch (error) {
    return res.status(500).json(new MessageDto(500, `Server Error.`, error));
  }
};

// Delete the ENTIRE conversation between the logged-in user and :recipient.
// (Previously this was deleteMany({}) — it wiped every message in the DB.)
const deleteChat = async (req, res) => {
  try {
    const me = req.user?.phone;
    const recipient = req.params.recipient;
    if (!recipient) {
      return res.status(400).json(new MessageDto(400, `Recipient is required.`));
    }

    const result = await MessageModel.deleteMany({
      $or: [
        { senderNumber: me, receiverNumber: recipient },
        { senderNumber: recipient, receiverNumber: me },
      ],
    });

    // Let the other party's open chat update in real time if they're online.
    emitToUsers([me, recipient], "chat-deleted", { by: me, with: recipient });

    return res
      .status(200)
      .json(new MessageDto(200, `Chat deleted.`, { deletedCount: result.deletedCount }));
  } catch (error) {
    return res.status(500).json(new MessageDto(500, `Server Error.`, error));
  }
};

module.exports = {
  getNoOfMessage,
  getMessage,
  getAllMessages,
  getMessagedUsers,
  sendMessage,
  updateMessage,
  deleteMessage,
  deleteChat,
};

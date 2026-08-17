const mongoose = require("mongoose");
const UserModel = require("../../models/UserModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const MessageModel = require("../../models/MessagesModel");
const { StatusCodes } = require("http-status-codes");
const { connectedSockets } = require("../../utilis/Socket");
const MessageDto = require("../../dtos/messageDto");
const { getUserTokens } = require("../../utilis/appTokens");
const sendNotification = require("../../utilis/sendNotification");

// Emit a socket event to each given phone number that has a live socket.
// Used to push edits/deletes to both parties in real time.
const emitToUsers = (phones, event, payload) => {
  phones.forEach((phone) => {
    const socket = connectedSockets[phone];
    if (socket) {
      socket.emit(event, payload);
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

const getMessage = (req, res) => {
  const senderNumber = req.query.senderNumber;
  const receiverNumber = req.query.receiverNumber;
  const me = req.user?.phone;

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

    const usersWithMessageCount = users.map((user) => ({
      ...user.toObject(),
      count: messageCount.find((m) => m.phone === user.phone)?.count || 0,
    }));

    // res.status(200).send(usersWithMessageCount);
    res.status(200).json(new MessageDto(200, `Recipients List for user ${phone}.`, {recipientsList: usersWithMessageCount}));
  } catch (err) {
    console.log(err);
    // res.status(500).send(err);
    res.status(500).json(new MessageDto(500, `Server Error.`, err));
  }
};

const sendMessage = async (req, res) => {
  let senderNumber = req.body.senderNumber;
  let receiverNumber = req.body.receiverNumber;
  let messageType = req.body.messageType;
  // The SERVER stamps the canonical timestamp in UTC (ISO 8601). We never trust
  // the client clock — this keeps ordering and times correct across devices in
  // different timezones. Clients convert this UTC value to local time only for
  // display (toLocaleTimeString).
  let dateTime = new Date().toISOString();
  // E2EE payload, produced entirely on the sender's device. The server stores
  // these opaquely and can never read the plaintext:
  //   text = AES-256-GCM ciphertext (base64), nonce = IV (base64),
  //   encryptedMessageKeys = { phone: wrapped Message Key } (incl. sender copy).
  let text = req.body.text || "";
  let nonce = req.body.nonce || "";
  let encryptedMessageKeys =
    req.body.encryptedMessageKeys && typeof req.body.encryptedMessageKeys === "object"
      ? req.body.encryptedMessageKeys
      : {};
  let replyTo = req.body.replyTo || null;
  console.log("message received (e2ee):", dateTime, "recipients:", Object.keys(encryptedMessageKeys))
  let msg = new MessageModel({
    senderNumber: senderNumber,
    receiverNumber: receiverNumber,
    text, // ciphertext, stored verbatim
    nonce,
    encryptedMessageKeys,
    dateTime: dateTime || "",
    messageType: messageType,
    replyTo,
  });
  msg
    .save()
    .then(async () => {
      const payload = {
        _id: String(msg._id),
        senderNumber,
        receiverNumber,
        text, // ciphertext
        nonce,
        encryptedMessageKeys,
        dateTime,
        messageType,
        replyTo,
        deliveredTo: [],
        readBy: [],
      };

      // The message is already persisted at this point. Live delivery is
      // best-effort: a sender who never registered a socket (or a recipient
      // who is offline) must not turn a successful save into a 500.
      try {
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
        // offline users still get the message. Best-effort: never fail the save.
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
            // Title = sender's display name (fall back to phone); body = the
            // message text for plaintext messages (generic for legacy E2EE).
            const sender = await UserModel.findOne({ phone: senderNumber }).select("name");
            const senderName = sender?.name || senderNumber;
            // E2EE: the server can't read the message, so the push is generic.
            const notifBody = "🔒 New message";
            const results = await Promise.allSettled(
              tokens.map((t) =>
                sendNotification({
                  notification: { title: senderName, body: notifBody },
                  data: {
                    senderNumber: String(senderNumber),
                    senderName: String(senderName),
                    body: String(notifBody),
                  },
                  android: { notification: { channelId: "default_channel" } },
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
          } catch (pushError) {
            console.error("[push] lookup failed:", pushError.message);
          }
        }
      } catch (socketError) {
        console.error("Live delivery failed, message still saved:", socketError);
      }

      res.status(200).json(new MessageDto(200, `Message send to ${receiverNumber}`, payload));
    })
    .catch((error) => {
      console.error("Error saving message:", error);
      res
        .status(500)
        .send({ error: error, message: "Error sending message.." });
    });
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

    // Real-time: relay the re-encrypted fields to both parties so their open
    // chat updates immediately; the recipient decrypts the new text locally.
    emitToUsers([updated.senderNumber, updated.receiverNumber], "message-edited", {
      _id: String(updated._id),
      text: updated.text, // ciphertext
      nonce: updated.nonce,
      encryptedMessageKeys: updated.encryptedMessageKeys,
      editedAt: updated.editedAt,
      senderNumber: updated.senderNumber,
      receiverNumber: updated.receiverNumber,
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

      // Real-time: turn the message into a tombstone on both devices at once.
      emitToUsers([updated.senderNumber, updated.receiverNumber], "message-deleted", {
        _id: String(updated._id),
        deletedForAll: true,
        senderNumber: updated.senderNumber,
        receiverNumber: updated.receiverNumber,
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

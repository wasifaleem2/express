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
  const phone = req.query.phone;
  console.log("this is ", phone);
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
      res.status(200).json(new MessageDto(200, `Messages for user with phone ${senderNumber}`, {messages: msgs}));
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json(new MessageDto(500, `Server Error`, err));
    });
};

const getAllMessages = (req, res) => {
  const phone = req.query.phone;
  MessageModel.find({
    $or: [{ senderNumber: phone }, { receiverNumber: phone }],
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
  let text = req.body.text;
  let messageType = req.body.messageType;
  let dateTime = req.body.dateTime;
  console.log("message data received", dateTime)
  // let time = new Date().toLocaleTimeString();
  // let messageType = "text";
  console.log("messageType", messageType);
  let msg = new MessageModel({
    senderNumber: senderNumber,
    receiverNumber: receiverNumber,
    text: text,
    dateTime: dateTime || "",
    messageType: messageType,
  });
  msg
    .save()
    .then(async () => {
      const payload = {
        _id: String(msg._id),
        senderNumber,
        receiverNumber,
        text,
        dateTime,
        messageType,
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
        if (recipient && !recipientOnline) {
          try {
            const tokens = await getUserTokens(recipient._id);
            await Promise.all(
              tokens.map((t) =>
                sendNotification({
                  notification: { title: senderNumber, body: text },
                  data: { senderNumber: String(senderNumber) },
                  token: t,
                }).catch((e) =>
                  console.error("push to token failed:", e.message)
                )
              )
            );
          } catch (pushError) {
            console.error("push lookup failed:", pushError.message);
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
  let text = req.body.text;
  try {
    // Was UserModel — edits silently did nothing. Update the message document,
    // stamp editedAt, and return the updated doc so the client can reconcile.
    const updated = await MessageModel.findOneAndUpdate(
      { _id: _id },
      { text: text, editedAt: new Date() },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json(new MessageDto(404, `Message not found.`));
    }

    // Real-time: push the edit to both parties so their open chat updates
    // immediately instead of only on the next fetch.
    emitToUsers([updated.senderNumber, updated.receiverNumber], "message-edited", {
      _id: String(updated._id),
      text: updated.text,
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
        { deletedForAll: true, deletedForAllAt: new Date(), text: "" },
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

const deleteChat = (req, res) => {
  MessageModel.deleteMany({})
    .then(() => {
      res.status(200).json(new MessageDto(200, `All messages deleted.`));
    })
    .catch((error) => {
      res.status(500).json(new MessageDto(500, `server Error.`, error));
    });
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

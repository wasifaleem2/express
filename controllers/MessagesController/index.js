const mongoose = require("mongoose");
const UserModel = require("../../models/UserModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const MessageModel = require("../../models/MessagesModel");
const { StatusCodes } = require("http-status-codes");
const { connectedSockets } = require("../../utilis/Socket");
const MessageDto = require("../../dtos/messageDto");

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
  // const phone = req.user.phone
  const senderNumber = req.query.senderNumber;
  const receiverNumber = req.query.receiverNumber;
  const phone = "555";
  // console.log(phone)
  MessageModel.find({
    $or: [
      { senderNumber: senderNumber, receiverNumber: receiverNumber },
      { senderNumber: receiverNumber, receiverNumber: senderNumber },
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

const updateMessage = (req, res) => {
  let _id = req.params.id;
  let text = req.body.text;
  UserModel.findOneAndUpdate({ _id: _id }, { text: text })
    .then(() => {
      res.status(200).json(new MessageDto(200, `Message updated with ${text}.`));
    })
    .catch((error) => {
      res.status(500).json(new MessageDto(500, `Server Error.`, error));
    });
};

const deleteMessage = (req, res) => {
  let _id = req.params.id;
  MessageModel.deleteOne({ _id: _id })
    .then(() => {
      res.status(200).json(new MessageDto(200, `Message deleted.`));
    })
    .catch((error) => {
      res.status(500).json(new MessageDto(500, `Server Error.`, error));
    });
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
